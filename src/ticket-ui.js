/** Frio Tickets — Painel Staff, Painel Membros e gerenciador de formulários */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
  ChannelType, AttachmentBuilder
} from 'discord.js';
import { emoji, icon } from './emojis.js';
import { buildTranscript } from './transcript.js';
import { getQuestions, formModal, readAnswers, stashAnswers, takeAnswers, MAX_QUESTIONS, DEFAULT_QUESTIONS } from './forms.js';

const V2 = MessageFlags.IsComponentsV2;
const EPH = MessageFlags.Ephemeral;
export const PRIORITIES = ['baixa', 'normal', 'alta', 'urgente'];
const notifyCooldown = new Map();
const cut = (v, n) => String(v ?? '').slice(0, n);

/* ---------- helpers de componentes ---------- */
const btn = (id, label, style, emojiKey, disabled = false) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emojiKey) b.setEmoji(emoji(emojiKey));
  return b;
};
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const text = content => new TextDisplayBuilder().setContent(content);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const colorOf = s => (/^#[0-9a-f]{6}$/i.test(s?.brand_color || '') ? parseInt(s.brand_color.slice(1), 16) : 0x5865f2);
const say = (i, msg, opening) => (opening ? i.editReply({ content: msg }) : i.followUp({ content: msg, flags: EPH }));
const closeModal = () => new ModalBuilder().setCustomId('ticket:close:channel').setTitle('Encerrar atendimento')
  .addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel('Motivo do encerramento').setStyle(TextInputStyle.Paragraph).setValue('Atendimento concluído').setRequired(true)));

const info = (t, d) => [
  `> **Ticket:** #${t.id}${d ? ` • ${cut(d.name, 60)}` : ''}`,
  `> **Cliente:** <@${t.user_id}>`,
  `> **Responsável:** ${t.claimed_by ? `<@${t.claimed_by}>` : 'Ninguém assumiu ainda'}`,
  `> **Prioridade:** ${t.priority || 'normal'}`,
  `> **Canal de voz:** ${t.voice_channel_id ? `<#${t.voice_channel_id}>` : 'Nenhum'}`
].join('\n');

/* ---------- painéis (Components V2, efêmeros) ---------- */
export function staffPanel(t, d, s, uid) {
  const mine = t.claimed_by === uid;
  const cur = t.priority || 'normal';
  return new ContainerBuilder().setAccentColor(colorOf(s))
    .addTextDisplayComponents(text(`## ${icon('config')} Painel Staff\n${info(t, d)}`))
    .addSeparatorComponents(sep())
    .addActionRowComponents(
      row(
        btn('tp:claim', mine ? 'Liberar ticket' : 'Assumir ticket', mine ? ButtonStyle.Secondary : ButtonStyle.Primary, 'claim'),
        btn('tp:notify', 'Notificar membro', ButtonStyle.Secondary, 'notify'),
        btn('tp:transcript', 'Transcript', ButtonStyle.Secondary, 'file')
      ),
      row(
        btn('tp:adduser', 'Adicionar usuário', ButtonStyle.Success, 'add'),
        btn('tp:rmuser', 'Remover usuário', ButtonStyle.Danger, 'remove'),
        btn('tp:rename', 'Renomear ticket', ButtonStyle.Secondary, 'edit')
      ),
      row(new StringSelectMenuBuilder().setCustomId('tp:prio').setPlaceholder(`Prioridade atual: ${cur}`).addOptions(
        PRIORITIES.map(p => ({ label: p[0].toUpperCase() + p.slice(1), value: p, default: p === cur, emoji: emoji('priority') })))),
      row(
        t.voice_channel_id
          ? btn('tp:voice', 'Excluir canal de voz', ButtonStyle.Danger, 'delete')
          : btn('tp:voice', 'Criar canal de voz', ButtonStyle.Success, 'phone'),
        btn('tp:refresh', 'Atualizar', ButtonStyle.Secondary, 'repeat'),
        btn('tp:close', 'Encerrar ticket', ButtonStyle.Danger, 'close')
      )
    );
}

export function memberPanel(t, d, s) {
  return new ContainerBuilder().setAccentColor(colorOf(s))
    .addTextDisplayComponents(text(`## ${icon('member')} Painel Membros\n${info(t, d)}\n\nUse **Notificar staff** para chamar quem assumiu o seu atendimento (ou a equipe, se ninguém assumiu ainda).`))
    .addSeparatorComponents(sep())
    .addActionRowComponents(row(
      btn('tm:notify', 'Notificar staff', ButtonStyle.Primary, 'notify'),
      btn('tm:refresh', 'Atualizar', ButtonStyle.Secondary, 'repeat'),
      btn('tm:close', 'Encerrar ticket', ButtonStyle.Danger, 'close')
    ));
}

function pickUserView(mode, s) {
  const add = mode === 'add';
  return new ContainerBuilder().setAccentColor(colorOf(s))
    .addTextDisplayComponents(text(`## ${icon(add ? 'add' : 'remove')} ${add ? 'Adicionar' : 'Remover'} usuário\nSelecione até 5 usuários.`))
    .addActionRowComponents(
      row(new UserSelectMenuBuilder().setCustomId(add ? 'tp:addpick' : 'tp:rmpick').setPlaceholder('Selecione os usuários').setMinValues(1).setMaxValues(5)),
      row(btn('tp:back', 'Voltar', ButtonStyle.Secondary, 'back'))
    );
}

/* ---------- carregar ticket + permissões ---------- */
async function load(i, ctx, { opening = false } = {}) {
  const t = await ctx.query('tickets', q => q.select('*').eq('channel_id', i.channelId).eq('status', 'open').maybeSingle());
  if (!t) { await say(i, 'Ticket não encontrado ou já encerrado.', opening); return null; }
  const s = await ctx.settings(i.guildId);
  const d = t.department_id ? await ctx.query('ticket_departments', q => q.select('*').eq('id', t.department_id).maybeSingle()) : null;
  // Só o cargo configurado (geral ou do departamento). Sem cargo configurado, apenas administradores.
  const roles = [s.staff_role_id, d?.staff_role_id].filter(Boolean);
  const staff = roles.length ? roles.some(r => i.member?.roles?.cache?.has(r)) : Boolean(ctx.admin(i));
  return { t, s, d, staff };
}

async function showStaff(i, L) { return i.editReply({ components: [staffPanel(L.t, L.d, L.s, i.user.id)], flags: V2 }); }
async function showMember(i, L) { return i.editReply({ components: [memberPanel(L.t, L.d, L.s)], flags: V2 }); }

/* ---------- voz ---------- */
function voicePerms(channel, botId) {
  return channel.permissionOverwrites.cache.map(o => {
    const canSee = o.allow.has(PermissionFlagsBits.ViewChannel);
    const allow = canSee ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] : [];
    if (o.id === botId) allow.push(PermissionFlagsBits.ManageChannels);
    return { id: o.id, type: o.type, allow, deny: o.deny.has(PermissionFlagsBits.ViewChannel) ? [PermissionFlagsBits.ViewChannel] : [] };
  });
}

/* ---------- entrada principal ---------- */
export async function handleTicketUI(i, ctx) {
  const id = i.customId;
  if (!id) return false;

  // Abertura: seleção do departamento → formulário (0 a 10 perguntas)
  if (i.isStringSelectMenu() && id === 'ticket:department') return openFromPanel(i, ctx);
  if (i.isModalSubmit() && id.startsWith('tk:form:')) return submitForm(i, ctx);
  if (i.isButton() && id.startsWith('tk:formnext:')) return nextFormPage(i, ctx);

  // Botões dentro do ticket
  if (i.isButton() && id === 'ticket:staff') return openStaff(i, ctx);
  if (i.isButton() && id === 'ticket:member') return openMember(i, ctx);
  if (id.startsWith('tp:')) return staffActions(i, ctx);
  if (id.startsWith('tm:')) return memberActions(i, ctx);
  if (id.startsWith('fm:')) return formAdmin(i, ctx);
  return false;
}

/* ---------- abertura de ticket ---------- */
async function openFromPanel(i, ctx) {
  if (!i.inGuild()) { await i.reply({ content: 'Apenas em servidores.', flags: EPH }); return true; }
  const departmentId = Number(i.values[0]);
  const ds = await ctx.departments(i.guildId);
  const dept = ds.find(x => x.id === departmentId);
  const resetMenu = () => i.message.edit({ components: ctx.panelRows(ds) }).catch(() => {});
  if (!dept) { await i.reply({ content: 'Departamento indisponível. Peça para a equipe publicar o painel novamente.', flags: EPH }); return true; }
  const questions = getQuestions(dept);
  if (!questions.length) {
    await i.deferReply({ flags: EPH });
    resetMenu();
    await ctx.openTicket(i, dept, []);
    return true;
  }
  await i.showModal(formModal(dept.id, questions, 0, dept.name));
  resetMenu();
  return true;
}

async function submitForm(i, ctx) {
  await i.deferReply({ flags: EPH });
  const [, , deptStr, pageStr] = i.customId.split(':');
  const deptId = Number(deptStr), page = Number(pageStr);
  const ds = await ctx.departments(i.guildId);
  const dept = ds.find(x => x.id === deptId);
  if (!dept) { await i.editReply({ content: 'Departamento não encontrado.' }); return true; }
  const questions = getQuestions(dept);
  const answers = readAnswers(i, questions, page);
  const key = `${i.guildId}:${i.user.id}:${deptId}`;
  if (questions.length > 5 && page === 0) {
    stashAnswers(key, answers);
    await i.editReply({ content: 'Primeira parte registrada. Clique abaixo para responder as perguntas restantes.', components: [row(btn(`tk:formnext:${deptId}`, 'Continuar formulário', ButtonStyle.Primary, 'arrow'))] });
    return true;
  }
  let all = answers;
  if (page === 1) {
    const first = takeAnswers(key);
    if (!first) { await i.editReply({ content: 'O formulário expirou. Selecione o departamento novamente.' }); return true; }
    all = [...first, ...answers];
  }
  await ctx.openTicket(i, dept, all);
  return true;
}

async function nextFormPage(i, ctx) {
  const deptId = Number(i.customId.split(':')[2]);
  const ds = await ctx.departments(i.guildId);
  const dept = ds.find(x => x.id === deptId);
  if (!dept) { await i.reply({ content: 'Departamento não encontrado.', flags: EPH }); return true; }
  await i.showModal(formModal(dept.id, getQuestions(dept), 1, dept.name));
  return true;
}

/* ---------- abrir painéis ---------- */
async function openStaff(i, ctx) {
  await i.deferReply({ flags: EPH });
  const L = await load(i, ctx, { opening: true });
  if (!L) return true;
  if (!L.staff) { await i.editReply({ content: 'Apenas a equipe configurada pode usar o Painel Staff.' }); return true; }
  await showStaff(i, L);
  return true;
}
async function openMember(i, ctx) {
  await i.deferReply({ flags: EPH });
  const L = await load(i, ctx, { opening: true });
  if (!L) return true;
  await showMember(i, L);
  return true;
}

/* ---------- ações do Painel Staff ---------- */
async function staffActions(i, ctx) {
  const id = i.customId;
  if (id === 'tp:close') { await i.showModal(closeModal()); return true; }
  if (id === 'tp:rename') {
    await i.showModal(new ModalBuilder().setCustomId('tp:renamem').setTitle('Renomear ticket')
      .addComponents(row(new TextInputBuilder().setCustomId('name').setLabel('Novo nome do canal').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))));
    return true;
  }
  const fromMessage = !i.isModalSubmit() || i.isFromMessage();
  try {
    if (fromMessage) await i.deferUpdate(); else await i.deferReply({ flags: EPH });
    const L = await load(i, ctx, { opening: !fromMessage });
    if (!L) return true;
    if (!L.staff) { await say(i, 'Apenas a equipe configurada pode usar o Painel Staff.', !fromMessage); return true; }
    const { t, s, d } = L;

    if (id === 'tp:refresh' || id === 'tp:back') { await showStaff(i, L); return true; }

    if (id === 'tp:claim') {
      const mine = t.claimed_by === i.user.id;
      await ctx.query('tickets', q => q.update({ claimed_by: mine ? null : i.user.id }).eq('id', t.id));
      await ctx.event(t.id, i.guildId, i.user.id, mine ? 'released' : 'claimed');
      t.claimed_by = mine ? null : i.user.id;
      await i.channel.send({
        content: mine ? `<@${i.user.id}> liberou o atendimento. A equipe já pode assumir novamente.` : `<@${t.user_id}>, seu atendimento foi assumido por <@${i.user.id}>.`,
        allowedMentions: { users: [t.user_id, i.user.id] }
      });
      await showStaff(i, L);
      return true;
    }

    if (id === 'tp:notify') {
      await i.channel.send({ content: `<@${t.user_id}>, a equipe solicitou sua atenção neste ticket. (por <@${i.user.id}>)`, allowedMentions: { users: [t.user_id] } });
      ctx.bot.users.fetch(t.user_id).then(u => u.send(`A equipe de **${i.guild.name}** solicitou sua atenção no ticket #${t.id}: https://discord.com/channels/${i.guildId}/${i.channelId}`)).catch(() => {});
      await i.followUp({ content: 'Membro notificado.', flags: EPH });
      return true;
    }

    if (id === 'tp:transcript') {
      const result = await buildTranscript(i.channel, t, { brand: ctx.brand, signature: ctx.signature, reason: 'Solicitado pela equipe', limit: Math.max(100, Math.min(10000, Number(process.env.TRANSCRIPT_MAX_MESSAGES) || 2000)) });
      await i.followUp({ content: `Transcript do ticket #${t.id} (${result.count} mensagens).`, files: [new AttachmentBuilder(Buffer.from(result.html, 'utf8'), { name: `ticket-${t.id}.html` })], flags: EPH });
      return true;
    }

    if (id === 'tp:adduser') { await i.editReply({ components: [pickUserView('add', s)], flags: V2 }); return true; }
    if (id === 'tp:rmuser') { await i.editReply({ components: [pickUserView('remove', s)], flags: V2 }); return true; }

    if (id === 'tp:addpick') {
      const voice = t.voice_channel_id ? await i.guild.channels.fetch(t.voice_channel_id).catch(() => null) : null;
      const added = [];
      for (const uid of i.values) {
        if (uid === ctx.bot.user.id) continue;
        await i.channel.permissionOverwrites.edit(uid, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        if (voice) await voice.permissionOverwrites.edit(uid, { ViewChannel: true, Connect: true, Speak: true }).catch(() => {});
        added.push(uid);
      }
      if (added.length) {
        await ctx.event(t.id, i.guildId, i.user.id, 'adicionar', { users: added });
        await i.channel.send({ content: `${added.map(u => `<@${u}>`).join(', ')} ${added.length > 1 ? 'foram adicionados' : 'foi adicionado'} ao ticket por <@${i.user.id}>.`, allowedMentions: { users: added } });
      }
      await showStaff(i, L);
      return true;
    }

    if (id === 'tp:rmpick') {
      const voice = t.voice_channel_id ? await i.guild.channels.fetch(t.voice_channel_id).catch(() => null) : null;
      const removed = [];
      for (const uid of i.values) {
        if (uid === t.user_id || uid === ctx.bot.user.id) { await i.followUp({ content: 'O autor do ticket e o bot não podem ser removidos.', flags: EPH }); continue; }
        await i.channel.permissionOverwrites.delete(uid).catch(() => {});
        if (voice) await voice.permissionOverwrites.delete(uid).catch(() => {});
        removed.push(uid);
      }
      if (removed.length) {
        await ctx.event(t.id, i.guildId, i.user.id, 'remover', { users: removed });
        await i.channel.send({ content: `${removed.map(u => `<@${u}>`).join(', ')} ${removed.length > 1 ? 'foram removidos' : 'foi removido'} do ticket por <@${i.user.id}>.`, allowedMentions: { parse: [] } });
      }
      await showStaff(i, L);
      return true;
    }

    if (id === 'tp:prio') {
      const value = i.values[0];
      if (!PRIORITIES.includes(value)) return true;
      await ctx.query('tickets', q => q.update({ priority: value }).eq('id', t.id));
      await ctx.event(t.id, i.guildId, i.user.id, 'priority', { priority: value });
      t.priority = value;
      if (['alta', 'urgente'].includes(value)) await i.channel.send({ content: `Prioridade do ticket definida como **${value}** por <@${i.user.id}>.`, allowedMentions: { parse: [] } });
      await showStaff(i, L);
      return true;
    }

    if (id === 'tp:voice') {
      if (t.voice_channel_id) {
        await i.guild.channels.delete(t.voice_channel_id, 'Canal de voz do ticket removido').catch(() => {});
        await ctx.query('tickets', q => q.update({ voice_channel_id: null }).eq('id', t.id));
        t.voice_channel_id = null;
        await i.channel.send({ content: `Canal de voz do ticket removido por <@${i.user.id}>.`, allowedMentions: { parse: [] } });
      } else {
        const vc = await i.guild.channels.create({
          name: cut(`voz-${i.channel.name}`, 100),
          type: ChannelType.GuildVoice,
          parent: i.channel.parentId || undefined,
          permissionOverwrites: voicePerms(i.channel, ctx.bot.user.id),
          reason: `Canal de voz do ticket #${t.id}`
        });
        try {
          await ctx.query('tickets', q => q.update({ voice_channel_id: vc.id }).eq('id', t.id));
        } catch (e) {
          await vc.delete().catch(() => {});
          throw new Error('Rode sql/007_painel_formularios_voz.sql no Supabase (coluna voice_channel_id ausente).');
        }
        t.voice_channel_id = vc.id;
        await ctx.event(t.id, i.guildId, i.user.id, 'voice_created', { channel: vc.id });
        await i.channel.send({ content: `Canal de voz criado: ${vc}. Ele será excluído quando o ticket for encerrado.`, allowedMentions: { parse: [] } });
      }
      await showStaff(i, L);
      return true;
    }

    if (id === 'tp:renamem') {
      const name = i.fields.getTextInputValue('name').toLowerCase().replace(/[^a-z0-9\-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 85);
      if (!name) { await say(i, 'Nome inválido.', !fromMessage); return true; }
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('O Discord limita renomear canais (2 vezes a cada 10 minutos). Tente mais tarde.')), 8000));
      await Promise.race([i.channel.setName(name), timeout]);
      await ctx.event(t.id, i.guildId, i.user.id, 'rename', { name });
      if (fromMessage) await showStaff(i, L); else await i.editReply({ content: `Ticket renomeado para **${name}**.` });
      return true;
    }
  } catch (e) {
    console.error('Painel Staff:', e);
    await i.followUp({ content: `Não foi possível concluir: ${cut(e.message, 200)}`, flags: EPH }).catch(() => {});
  }
  return true;
}

/* ---------- ações do Painel Membros ---------- */
async function memberActions(i, ctx) {
  const id = i.customId;
  if (id === 'tm:close') { await i.showModal(closeModal()); return true; }
  try {
    await i.deferUpdate();
    const L = await load(i, ctx);
    if (!L) return true;
    if (id === 'tm:refresh') { await showMember(i, L); return true; }
    if (id === 'tm:notify') {
      const { t, s, d } = L;
      const wait = 60000 - (Date.now() - (notifyCooldown.get(t.id) || 0));
      if (wait > 0) { await i.followUp({ content: `Aguarde ${Math.ceil(wait / 1000)}s para notificar novamente.`, flags: EPH }); return true; }
      notifyCooldown.set(t.id, Date.now());
      const roles = [s.staff_role_id, d?.staff_role_id].filter(Boolean);
      const target = t.claimed_by ? `<@${t.claimed_by}>` : roles.map(r => `<@&${r}>`).join(' ');
      await i.channel.send({
        content: `${target ? `${target} ` : ''}<@${i.user.id}> solicitou a atenção da equipe neste ticket.`,
        allowedMentions: { users: [i.user.id, ...(t.claimed_by ? [t.claimed_by] : [])], roles: t.claimed_by ? [] : roles }
      });
      await showMember(i, L);
      await i.followUp({ content: t.claimed_by ? 'Responsável notificado.' : 'Equipe notificada.', flags: EPH });
      return true;
    }
  } catch (e) {
    console.error('Painel Membros:', e);
    await i.followUp({ content: `Não foi possível concluir: ${cut(e.message, 200)}`, flags: EPH }).catch(() => {});
  }
  return true;
}

/* ---------- gerenciador de formulários (/ticket config → Departamentos) ---------- */
function formView(dept, s, ctx) {
  const qs = getQuestions(dept);
  const list = qs.length
    ? qs.map((q, n) => `**${n + 1}.** ${q.label} — ${q.style === 'short' ? 'curta' : 'longa'}${q.required ? '' : ' • opcional'}`).join('\n')
    : 'Sem formulário: o ticket abre direto ao selecionar o departamento.';
  const e = ctx.embed(`${icon('departments')} Formulário • ${cut(dept.name, 80)}`, `**Perguntas (${qs.length}/${MAX_QUESTIONS})**\n${list}\n\nAté 5 perguntas abrem em uma janela; de 6 a 10, o membro responde em duas etapas.`, s);
  const rows = [row(
    btn(`fm:add:${dept.id}`, 'Adicionar pergunta', ButtonStyle.Success, 'add', qs.length >= MAX_QUESTIONS),
    btn(`fm:none:${dept.id}`, 'Sem formulário', ButtonStyle.Secondary, 'disable', qs.length === 0),
    btn(`fm:reset:${dept.id}`, 'Restaurar padrão', ButtonStyle.Secondary, 'repeat')
  )];
  if (qs.length) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`fm:rm:${dept.id}`).setPlaceholder('Remover uma pergunta')
      .addOptions(qs.map((q, n) => ({ label: cut(`${n + 1}. ${q.label}`, 100), value: String(n), emoji: emoji('delete') })))));
  }
  rows.push(row(btn('fm:back', 'Voltar', ButtonStyle.Secondary, 'back')));
  return { embeds: [e], components: rows };
}

async function saveQuestions(ctx, guildId, deptId, questions) {
  try {
    await ctx.query('ticket_departments', q => q.update({ form_questions: questions }).eq('id', deptId).eq('guild_id', guildId));
  } catch (e) {
    if (/form_questions/.test(e.message)) throw new Error('Rode sql/007_painel_formularios_voz.sql no Supabase (coluna form_questions ausente).');
    throw e;
  }
  ctx.departmentCache.delete(guildId);
}

async function formAdmin(i, ctx) {
  const id = i.customId;
  if (!i.inGuild() || !ctx.admin(i)) { await i.reply({ content: 'Acesso negado.', flags: EPH }); return true; }
  const [, action, deptStr] = id.split(':');
  const deptId = Number(deptStr);

  if (action === 'add') {
    await i.showModal(new ModalBuilder().setCustomId(`fm:addq:${deptId}`).setTitle('Nova pergunta').addComponents(
      row(new TextInputBuilder().setCustomId('label').setLabel('Texto da pergunta (até 45)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(45)),
      row(new TextInputBuilder().setCustomId('placeholder').setLabel('Texto de exemplo (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
      row(new TextInputBuilder().setCustomId('style').setLabel('Resposta: curta ou longa').setStyle(TextInputStyle.Short).setRequired(true).setValue('longa').setMaxLength(10)),
      row(new TextInputBuilder().setCustomId('required').setLabel('Obrigatória? (sim/não)').setStyle(TextInputStyle.Short).setRequired(true).setValue('sim').setMaxLength(5))
    ));
    return true;
  }

  try {
    if (i.isModalSubmit() && !i.isFromMessage()) await i.deferReply({ flags: EPH }); else await i.deferUpdate();
    const s = await ctx.settings(i.guildId);

    if (action === 'back') { await i.editReply(await ctx.departmentsView(i.guildId)); return true; }

    const pickedId = action === 'pick' ? Number(i.values[0]) : deptId;
    const dept = await ctx.query('ticket_departments', q => q.select('*').eq('id', pickedId).eq('guild_id', i.guildId).maybeSingle());
    if (!dept) { await i.followUp({ content: 'Departamento não encontrado.', flags: EPH }); return true; }

    if (action === 'addq') {
      const qs = getQuestions(dept);
      if (qs.length >= MAX_QUESTIONS) { await i.followUp({ content: `Limite de ${MAX_QUESTIONS} perguntas por departamento.`, flags: EPH }); return true; }
      const get = k => i.fields.getTextInputValue(k).trim();
      const label = cut(get('label'), 45);
      if (!label) { await i.followUp({ content: 'Informe o texto da pergunta.', flags: EPH }); return true; }
      qs.push({ label, placeholder: cut(get('placeholder'), 100), style: /^c/i.test(get('style')) ? 'short' : 'paragraph', required: ['sim', 's', 'true', 'yes'].includes(get('required').toLowerCase()) });
      await saveQuestions(ctx, i.guildId, dept.id, qs);
      dept.form_questions = qs;
    } else if (action === 'rm') {
      const qs = getQuestions(dept);
      qs.splice(Number(i.values[0]), 1);
      await saveQuestions(ctx, i.guildId, dept.id, qs);
      dept.form_questions = qs;
    } else if (action === 'none') {
      await saveQuestions(ctx, i.guildId, dept.id, []);
      dept.form_questions = [];
    } else if (action === 'reset') {
      await saveQuestions(ctx, i.guildId, dept.id, DEFAULT_QUESTIONS);
      dept.form_questions = DEFAULT_QUESTIONS;
    }
    await i.editReply(formView(dept, s, ctx));
  } catch (e) {
    console.error('Formulários:', e);
    await i.followUp({ content: `Não foi possível concluir: ${cut(e.message, 200)}`, flags: EPH }).catch(() => {});
  }
  return true;
}
