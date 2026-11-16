/** Frio Tickets — /call: mantém o bot em uma call de voz e volta sozinho depois de quedas. */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits
} from 'discord.js';
import { emoji, icon } from './emojis.js';

const V2 = MessageFlags.IsComponentsV2;
const EPH = MessageFlags.Ephemeral;
const TABLE = 'ticket_call_presence';

let bot = null, query = null;
let libPromise = null;
const lib = () => (libPromise ??= import('@discordjs/voice').catch(e => { libPromise = null; throw new Error(`@discordjs/voice não instalado (${e.message})`); }));

const desired = new Map(); // guildId -> channelId em que o bot deve ficar
const busy = new Set();    // guildIds com entrada em andamento
const picked = new Map();  // `${guildId}:${userId}` -> canal escolhido no menu

/* ---------- conexão ---------- */
async function connect(guild, channelId) {
  const V = await lib();
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw Object.assign(new Error('canal de voz inexistente'), { gone: true });
  const me = guild.members.me || await guild.members.fetchMe();
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) throw new Error('o bot precisa das permissões Ver canal e Conectar nesse canal');

  const current = V.getVoiceConnection(guild.id);
  if (current && current.state.status === V.VoiceConnectionStatus.Ready && current.joinConfig.channelId === channelId && me.voice?.channelId === channelId) return;
  if (current) { try { current.destroy(); } catch {} }

  const connection = V.joinVoiceChannel({ channelId, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: true });
  connection.on(V.VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([V.entersState(connection, V.VoiceConnectionStatus.Signalling, 5000), V.entersState(connection, V.VoiceConnectionStatus.Connecting, 5000)]);
    } catch { try { connection.destroy(); } catch {} } // o vigia reconecta
  });
  try {
    await V.entersState(connection, V.VoiceConnectionStatus.Ready, 20000);
  } catch {
    try { connection.destroy(); } catch {}
    throw new Error('não consegui conectar na call (tempo esgotado)');
  }
}

/** Garante que o bot esteja na call desejada (usado na volta do sistema, pelo vigia e ao ser desconectado). */
async function ensure(guild, why) {
  const channelId = desired.get(guild.id);
  if (!channelId || busy.has(guild.id)) return;
  try {
    const V = await lib();
    const c = V.getVoiceConnection(guild.id);
    if (c && c.state.status === V.VoiceConnectionStatus.Ready && c.joinConfig.channelId === channelId && guild.members.me?.voice?.channelId === channelId) return;
  } catch { /* sem biblioteca: connect() reporta */ }
  busy.add(guild.id);
  try {
    await connect(guild, channelId);
    console.log(`[Call] ${guild.id}: de volta à call (${why})`);
  } catch (e) {
    if (e.gone) {
      desired.delete(guild.id);
      await query(TABLE, q => q.delete().eq('guild_id', guild.id)).catch(() => {});
      console.warn(`[Call] ${guild.id}: o canal foi apagado; presença removida`);
    } else console.warn(`[Call] ${guild.id}: ${e.message}`);
  } finally { busy.delete(guild.id); }
}

/* ---------- API ---------- */
export function registerCall(client, { query: q }) {
  bot = client; query = q;
  // Saiu/foi tirado da call (queda, kick, mudança de canal): volta em 3 s.
  bot.on('voiceStateUpdate', (_old, now) => {
    if (now.id !== bot.user?.id) return;
    const want = desired.get(now.guild.id);
    if (want && now.channelId !== want) setTimeout(() => ensure(now.guild, 'saiu da call'), 3000);
  });
  // Vigia: confere a cada 45 s se continua na call.
  setInterval(() => { for (const gid of desired.keys()) { const g = bot.guilds.cache.get(gid); if (g) ensure(g, 'vigia').catch(() => {}); } }, 45000).unref();
}

/** Chamar no clientReady: relê o banco e volta para as calls salvas depois de queda/reinício da hospedagem. */
export async function restoreCalls() {
  let rows = [];
  try { rows = await query(TABLE, q => q.select('guild_id,channel_id')); } catch (e) { console.warn('[Call] tabela ausente? rode sql/008_call_presence.sql:', e.message); return; }
  for (const r of rows) {
    desired.set(r.guild_id, r.channel_id);
    const g = bot.guilds.cache.get(r.guild_id);
    if (g) await ensure(g, 'sistema reiniciou');
    await new Promise(res => setTimeout(res, 1500));
  }
  if (rows.length) console.log(`[Call] ${rows.length} presença(s) restaurada(s)`);
}

async function callJoin(guild, channelId, userId) {
  busy.add(guild.id);
  let saved = true, saveError = '';
  try {
    await connect(guild, channelId);
    desired.set(guild.id, channelId);
    try { await query(TABLE, q => q.upsert({ guild_id: guild.id, channel_id: channelId, set_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })); }
    catch (e) { saved = false; saveError = e.message; }
  } finally { busy.delete(guild.id); }
  return { saved, saveError };
}

async function callLeave(guild) {
  desired.delete(guild.id);
  await query(TABLE, q => q.delete().eq('guild_id', guild.id)).catch(() => {});
  try { const V = await lib(); V.getVoiceConnection(guild.id)?.destroy(); } catch {}
  const me = guild.members.me;
  if (me?.voice?.channelId) await me.voice.disconnect('Saiu pelo /call').catch(() => {});
}

/* ---------- painel (Components V2) ---------- */
async function panel(guild, uid, s) {
  let where = null;
  try { const V = await lib(); const c = V.getVoiceConnection(guild.id); if (c && c.state.status === V.VoiceConnectionStatus.Ready) where = c.joinConfig.channelId; } catch {}
  const want = desired.get(guild.id), sel = picked.get(`${guild.id}:${uid}`);
  const color = /^#[0-9a-f]{6}$/i.test(s?.brand_color || '') ? parseInt(s.brand_color.slice(1), 16) : 0x5865f2;
  const btn = (id, label, style, key) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setEmoji(emoji(key));
  return new ContainerBuilder().setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${icon('phone')} Call do bot`,
      `> **Estado:** ${where ? `conectado em <#${where}>` : 'fora da call'}`,
      `> **Volta sozinho após queda:** ${want ? `sim, em <#${want}>` : 'não (use Entrar para ativar)'}`,
      `> **Destino escolhido:** ${sel ? `<#${sel}>` : 'a sua call atual'}`
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('call:pick').setPlaceholder('Escolher a call (opcional)').setChannelTypes(ChannelType.GuildVoice).setMinValues(1).setMaxValues(1)),
      new ActionRowBuilder().addComponents(
        btn('call:join', 'Entrar', ButtonStyle.Success, 'phone'),
        btn('call:leave', 'Sair', ButtonStyle.Danger, 'remove'),
        btn('call:refresh', 'Atualizar', ButtonStyle.Secondary, 'repeat')
      )
    );
}

async function allowed(i, ctx) {
  if (ctx.admin(i) || i.memberPermissions?.has(PermissionFlagsBits.MoveMembers)) return true;
  const s = await ctx.settings(i.guildId);
  return Boolean(s.staff_role_id && i.member?.roles?.cache?.has(s.staff_role_id));
}

export async function handleCall(i, ctx) {
  const isCmd = i.isChatInputCommand?.() && i.commandName === 'call';
  if (!isCmd && !(i.customId || '').startsWith('call:')) return false;
  if (!i.inGuild()) { await i.reply({ content: 'Disponível apenas em servidores.', flags: EPH }); return true; }
  if (!(await allowed(i, ctx))) { await i.reply({ content: 'Apenas a equipe, quem pode mover membros ou administradores podem usar o /call.', flags: EPH }); return true; }
  const s = await ctx.settings(i.guildId);
  if (isCmd) { await i.reply({ components: [await panel(i.guild, i.user.id, s)], flags: V2 | EPH }); return true; }

  await i.deferUpdate();
  const key = `${i.guildId}:${i.user.id}`;
  try {
    if (i.customId === 'call:pick') picked.set(key, i.values[0]);
    if (i.customId === 'call:join') {
      const target = picked.get(key) || i.member?.voice?.channelId;
      if (!target) await i.followUp({ content: 'Escolha uma call no menu ou entre em uma call e clique em Entrar.', flags: EPH });
      else {
        const r = await callJoin(i.guild, target, i.user.id);
        if (!r.saved) await i.followUp({ content: `O bot entrou, mas não consegui salvar a presença (rode o SQL 008 no Supabase): ${r.saveError}. Sem isso ele não volta sozinho após uma queda.`, flags: EPH });
      }
    }
    if (i.customId === 'call:leave') await callLeave(i.guild);
  } catch (e) {
    await i.followUp({ content: `Não foi possível concluir: ${String(e.message).slice(0, 300)}`, flags: EPH }).catch(() => {});
  }
  await i.editReply({ components: [await panel(i.guild, i.user.id, s)], flags: V2 });
  return true;
}
