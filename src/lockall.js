import { ChannelType, PermissionFlagsBits } from 'discord.js';

// Não altera SendMessagesInThreads: tópicos existentes permanecem disponíveis.
const LOCK_PERMS = {
 SendMessages: PermissionFlagsBits.SendMessages,
 CreatePublicThreads: PermissionFlagsBits.CreatePublicThreads,
 CreatePrivateThreads: PermissionFlagsBits.CreatePrivateThreads,
};
const ELIGIBLE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);
const guildJobs = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = (overwrite, permission) => overwrite?.allow.has(permission) ? true : overwrite?.deny.has(permission) ? false : null;
const snapshot = overwrite => Object.fromEntries(Object.entries(LOCK_PERMS).map(([name, bit]) => [name, status(overwrite, bit)]));
const response = (m, content) => m.reply({content,allowedMentions:{parse:[],repliedUser:false}});

export async function handleServerLock(m, db) {
 const command = String(m.content || '').trim().toLowerCase();
 if (command !== '+lockall' && command !== '+unlockall') return false;
 if (!m.guild || m.author.bot) return true;
 const guild = m.guild;
 if (!m.member?.permissions.has(PermissionFlagsBits.Administrator) && m.author.id !== guild.ownerId) {
  await response(m, 'Somente administradores do servidor podem usar este comando.');
  return true;
 }
 if (guildJobs.has(guild.id)) { await response(m, 'Já existe uma operação de bloqueio/desbloqueio em andamento neste servidor.'); return true; }
 guildJobs.add(guild.id);
 try {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
   await response(m, 'Preciso da permissão **Gerenciar Canais** para alterar as permissões.');
   return true;
  }
  const lock = command === '+lockall';
  await response(m, lock ? 'Aplicando bloqueio aos canais de texto…' : 'Restaurando permissões dos canais…');
  // Falha imediatamente se a migração SQL ainda não foi executada.
  const {error:tableError}=await db.from('ticket_lockall_backups').select('channel_id').eq('guild_id',guild.id).limit(1);
  if(tableError)throw tableError;
  const channels = await guild.channels.fetch();
  const targets = [...channels.values()].filter(c => c && ELIGIBLE.has(c.type));
  let changed = 0, skipped = 0, failed = 0;
  if (lock) {
   for (const ch of targets) {
    try {
     const {data:existing,error:readError} = await db.from('ticket_lockall_backups').select('channel_id').eq('guild_id',guild.id).eq('channel_id',ch.id).maybeSingle();
     if(readError) throw readError;
     if(existing) {skipped++;continue;}
     const original = snapshot(ch.permissionOverwrites.cache.get(guild.id));
     const {error:writeError} = await db.from('ticket_lockall_backups').insert({guild_id:guild.id,channel_id:ch.id,previous_permissions:original});
     if(writeError) throw writeError;
     try {
      await ch.permissionOverwrites.edit(guild.roles.everyone, {SendMessages:false,CreatePublicThreads:false,CreatePrivateThreads:false}, {reason:`+lockall por ${m.author.id}`});
      changed++;
     } catch(err) {
      await db.from('ticket_lockall_backups').delete().eq('guild_id',guild.id).eq('channel_id',ch.id);
      throw err;
     }
    } catch(e) {failed++;console.warn(`[lockall] ${guild.id}/${ch.id}: ${e.message}`);}
    await pause(100);
   }
  } else {
   const {data:backups,error} = await db.from('ticket_lockall_backups').select('channel_id,previous_permissions').eq('guild_id',guild.id);
   if(error) throw error;
   for(const row of backups||[]) {
    try {
     const ch=channels.get(row.channel_id);
     if (ch && ELIGIBLE.has(ch.type)) {
      const previous=row.previous_permissions||{};
      const restored=Object.fromEntries(Object.keys(LOCK_PERMS).map(k=>[k,previous[k]===true?true:previous[k]===false?false:null]));
      await ch.permissionOverwrites.edit(guild.roles.everyone,restored,{reason:`+unlockall por ${m.author.id}`});
      changed++;
     } else skipped++;
     const {error:delError}=await db.from('ticket_lockall_backups').delete().eq('guild_id',guild.id).eq('channel_id',row.channel_id);
     if(delError)throw delError;
    }catch(e){failed++;console.warn(`[unlockall] ${guild.id}/${row.channel_id}: ${e.message}`);}
    await pause(100);
   }
  }
  await m.channel.send({content:`**${lock?'Bloqueio':'Desbloqueio'} concluído.** Canais alterados: **${changed}** · Ignorados: **${skipped}** · Falhas: **${failed}**.\n${lock?'Os membros não poderão mandar mensagens nos canais nem criar novos tópicos. A permissão de escrever em tópicos existentes não foi alterada.':'As três permissões foram restauradas ao estado anterior ao bloqueio.'}\nCargos com permissões explícitas de permitir, e administradores, podem ter exceções.`,allowedMentions:{parse:[]}});
 }catch(e){console.error('[lockall]',e);await m.channel.send({content:`Não foi possível concluir: ${String(e.message).slice(0,240)}. Confira se executou o SQL 014 e se o bot pode gerenciar canais.`,allowedMentions:{parse:[]}}).catch(()=>{});}
 finally {guildJobs.delete(guild.id);}
 return true;
}
