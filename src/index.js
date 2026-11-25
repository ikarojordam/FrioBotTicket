/** Frio Tickets v4.3.1 — Desenvolvido por FrioBots • FrioStore */
import 'dotenv/config';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, AttachmentBuilder, Options } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { buildTranscript } from './transcript.js';
import { emoji, icon, bindEmojiClient } from './emojis.js';
import { syncGuildEmojis } from './emoji-sync.js';
import { handleTicketUI } from './ticket-ui.js';
import { registerCall, restoreCalls, handleCall } from './call.js';
import { VERSION_LABEL } from './version.js';
import { getQuestions } from './forms.js';
import { createKnowledge, clearKnowledge, expireKnowledge } from './knowledge-db.js';
import { imageAttachment } from './image-attachment.js';
import { handleServerLock } from './lockall.js';
import { publicApiAnswer, expirePublicApiCache } from './public-apis.js';

const needed=['DISCORD_TOKEN','DISCORD_CLIENT_ID','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
for(const k of needed)if(!process.env[k])throw new Error(`Variável obrigatória ausente: ${k}`);
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}});
const knowledge=createKnowledge(db);
const bot=new Client({
 intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildVoiceStates],
 makeCache:Options.cacheWithLimits({
  ...Options.DefaultMakeCacheSettings,
  MessageManager:10,
  GuildMemberManager:60,
  UserManager:120,
  ReactionManager:0,
  PresenceManager:0,
  GuildBanManager:0,
  GuildInviteManager:0,
  GuildStickerManager:0,
  ThreadMemberManager:40,
 }),
 sweepers:{
  ...Options.DefaultSweeperSettings,
  messages:{interval:10,lifetime:120},
  users:{interval:600,filter:()=>user=>user.id!==bot.user?.id},
 },
});
bindEmojiClient(bot);
const devs=new Set((process.env.DEV_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
const brand=process.env.BRAND_NAME||'Frio Tickets',fallbackSignature=process.env.BRAND_SIGNATURE||'Desenvolvido por FrioBots • FrioStore';
let globalBrand={signature:fallbackSignature,banner_url:process.env.BRAND_IMAGE_URL||null,banner_visible:false,activity_text:`${brand} • /ticket config`};
const signature=()=>globalBrand.signature;
async function loadGlobalBrand(){const row=await query('ticket_global_brand',q=>q.select('*').eq('id',1).maybeSingle());if(row)globalBrand={...globalBrand,...row};}
const isHttpsUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.hostname.length>3&&v.length<=2000;}catch{return false;}};
const devOnly=i=>devs.has(i.user.id);
const defaults={panel_title:'Central de Atendimento',panel_description:'Selecione o departamento para iniciar seu atendimento.',brand_color:'#5865F2',welcome_text:'Descreva sua solicitação para nossa equipe.',ai_enabled:false,ai_prompt:'Você é um atendente cordial e profissional. Se não souber, encaminhe a uma pessoa.',knowledge_base:'',max_open_tickets:2,inactivity_hours:0,transcript_enabled:true,dm_rating_enabled:true,ticket_mode:'channel',thread_parent_id:null,transcript_log_channel_id:null,rating_log_channel_id:null};
const cache=new Map(),locks=new Set(),aiCooldown=new Map();
// Espera de 25 s após a criação do ticket; no máximo uma mensagem pendente por canal.
const pendingAi=new Map();
function cancelPendingAi(channelId){const pending=pendingAi.get(channelId);if(pending?.timer)clearTimeout(pending.timer);pendingAi.delete(channelId);}
const departmentCache=new Map();
const pendingSettings=new Map();
const pendingDepartments=new Map();
const CACHE_TTL_MS=Math.max(5000,Number(process.env.CACHE_TTL_MS)||60000);
const PERF_LOG=process.env.PERF_LOG==='true';
// A cada 10 s, expira SOMENTE entradas temporárias antigas.
// Não limpa guilds, canais, conexões de voz ou configurações ainda válidas.
let lastRamLog=0;
setInterval(()=>{
 const now=Date.now();
 for(const [id,entry] of cache) if(now-entry.time>CACHE_TTL_MS)cache.delete(id);
 for(const [id,entry] of departmentCache) if(now-entry.time>CACHE_TTL_MS)departmentCache.delete(id);
 for(const [id,time] of aiCooldown) if(now-time>3600000)aiCooldown.delete(id);
 expireKnowledge();
 expirePublicApiCache();
 for(const [k,t] of mentionCooldown)if(now-t>60000)mentionCooldown.delete(k);
 if(process.env.RAM_LOG==='true' && now-lastRamLog>=60000){
  lastRamLog=now;
  const mb=Math.round(process.memoryUsage().rss/1048576);
  console.log(`[RAM] RSS: ${mb} MB / meta 240 MB`);
  if(mb>225)console.warn(`[RAM] Perto da meta: ${mb} MB`);
 }
},10000).unref();

const stamp=()=>new Date().toISOString();
const color=s=>/^#[0-9a-f]{6}$/i.test(s?.brand_color||'')?parseInt(s.brand_color.slice(1),16):0x5865f2;
const embed=(title,description,s={})=>{const m=/^(<a?:[^:]+:\d+>)\s*[•·-]?\s*(.*)$/.exec(String(title||''));const e=new EmbedBuilder().setTitle(safe(m?m[2]||brand:title,256)).setDescription(safe(m?`${m[1]}\u2003${description||''}`:(description||' '),4000)).setColor(color(s)).setFooter({text:signature()});if(s.image_url&&/^https:\/\//.test(s.image_url))e.setImage(s.image_url);else if(globalBrand.banner_visible&&isHttpsUrl(globalBrand.banner_url))e.setImage(globalBrand.banner_url);return e;};
const ephemeral=MessageFlags.Ephemeral;
// Link oficial OAuth2, gerado sempre com o ID da aplicação conectada.
// Sem Administrator: solicita apenas permissões necessárias aos recursos do bot.
const INVITE_PERMISSIONS = [
 PermissionFlagsBits.ViewChannel,
 PermissionFlagsBits.SendMessages,
 PermissionFlagsBits.ReadMessageHistory,
 PermissionFlagsBits.EmbedLinks,
 PermissionFlagsBits.AttachFiles,
 PermissionFlagsBits.ManageChannels,
 PermissionFlagsBits.ManageThreads,
 PermissionFlagsBits.CreatePrivateThreads,
 PermissionFlagsBits.SendMessagesInThreads,
 PermissionFlagsBits.ManageMessages,
 PermissionFlagsBits.Connect,
 PermissionFlagsBits.MoveMembers,
 PermissionFlagsBits.ManageGuildExpressions,
].reduce((a,b)=>a|b,0n);
function inviteUrl(){
 const clientId=bot.application?.id||bot.user?.id||process.env.DISCORD_CLIENT_ID;
 const params=new URLSearchParams({client_id:clientId,permissions:INVITE_PERMISSIONS.toString(),scope:'bot applications.commands',response_type:'code'});
 // OAuth2 de instalação de bot: sem redirect_uri nem response_type.
 params.delete('response_type');
 return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
function inviteMessage(){
 const link=inviteUrl();
 const button=new ButtonBuilder().setLabel('Adicionar em um servidor').setStyle(ButtonStyle.Link).setURL(link);
 return {embeds:[embed('Adicionar Frio Tickets', 'Autorize o bot em outro servidor pelo botão abaixo. Você precisa ter permissão para adicionar aplicativos ao servidor.\n\nAs permissões são solicitadas durante a autorização; revise-as antes de confirmar.')],components:[new ActionRowBuilder().addComponents(button)]};
}

function devPanel(){
 const status=globalBrand.banner_visible?'Ativo':'Oculto';
 const e=embed(`${icon('config')} • Central do desenvolvedor`,
 `**IDENTIDADE DO BOT**\n> **Nome:** ${bot.user?.username||brand}\n> **Atividade:** ${safe(globalBrand.activity_text,100)}\n> **Assinatura:** ${safe(signature(),160)}\n> **Banner:** ${status}\n\n**SISTEMA**\n> **Versão:** ${VERSION_LABEL}\n> **Servidores:** ${bot.guilds.cache.size}\n> **Hospedagem:** Discloud • **Banco:** Supabase\n\nEscolha uma ferramenta abaixo para editar.`,{});
 e.setAuthor({name:'FRIO TICKETS • Administração global'});
 const B=(id,label,key,style=ButtonStyle.Secondary)=>{const b=new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);if(key)b.setEmoji(emoji(key));return b;};
 return {embeds:[e],components:[
  new ActionRowBuilder().addComponents(B('dev:profile','Perfil','appearance',ButtonStyle.Primary),B('dev:signature','Assinatura','edit'),B('dev:banner','Banner','publish'),B('dev:toggle_banner',globalBrand.banner_visible?'Ocultar banner':'Mostrar banner',globalBrand.banner_visible?'disable':'enable')),
  new ActionRowBuilder().addComponents(B('dev:diagnostics','Diagnóstico','stats',ButtonStyle.Primary),B('dev:servers','Servidores','departments'),B('dev:cache','Limpar cache','delete'),B('dev:test_ai','Testar IA','ai')),
  new ActionRowBuilder().addComponents(B('dev:sync_commands','Sincronizar /','repeat'),B('dev:sync_emojis','Sincronizar emojis','verify'),B('dev:invite','Link de convite','publish')),
  new ActionRowBuilder().addComponents(B('dev:refresh','Atualizar','config'))]};
}
async function persistGlobalBrand(patch){const next={...globalBrand,...patch};await query('ticket_global_brand',q=>q.upsert({id:1,signature:next.signature,banner_url:next.banner_url,banner_visible:next.banner_visible,activity_text:next.activity_text,updated_at:stamp()},{onConflict:'id'}));globalBrand=next;}

const admin=i=>i.memberPermissions?.has(PermissionFlagsBits.Administrator)||devs.has(i.user.id);
const safe=(x,n=1000)=>String(x||'').slice(0,n);
async function query(table,fn){const r=await fn(db.from(table));if(r.error)throw new Error(`${table}: ${r.error.message}`);return r.data;}
async function settings(g){
 const c=cache.get(g);if(c&&Date.now()-c.time<CACHE_TTL_MS)return c.data;
 if(pendingSettings.has(g))return pendingSettings.get(g);
 const pending=(async()=>{const row=await query('ticket_settings',q=>q.select('*').eq('guild_id',g).maybeSingle());const data={...defaults,...row};cache.set(g,{data,time:Date.now()});return data;})();
 pendingSettings.set(g,pending);try{return await pending;}finally{pendingSettings.delete(g);}
}
async function save(g,patch){const current=await settings(g);await query('ticket_settings',q=>q.upsert({guild_id:g,...patch,updated_at:stamp()},{onConflict:'guild_id'}));cache.set(g,{data:{...current,...patch},time:Date.now()});}
async function departments(g){
 const c=departmentCache.get(g);if(c&&Date.now()-c.time<CACHE_TTL_MS)return c.data;
 if(pendingDepartments.has(g))return pendingDepartments.get(g);
 const pending=(async()=>{const data=await query('ticket_departments',q=>q.select('*').eq('guild_id',g).eq('enabled',true).order('sort_order').order('id'));departmentCache.set(g,{data,time:Date.now()});return data;})();
 pendingDepartments.set(g,pending);try{return await pending;}finally{pendingDepartments.delete(g);}
}
const EVENT_LABELS={opened:'Ticket aberto',closed:'Ticket encerrado',claimed:'Atendimento assumido',priority:'Prioridade alterada',rename:'Canal renomeado',adicionar:'Membro adicionado',remover:'Membro removido'};
const logValue=(v)=>safe(String(v??'—').replace(/@/g,'＠'),850);
async function sendTicketLog(guildId,kind,title,fields=[],attachment=null){
 try{
  const s=await settings(guildId);
  const targetId=kind==='transcript'?(s.transcript_log_channel_id||s.log_channel_id):kind==='rating'?(s.rating_log_channel_id||s.log_channel_id):s.log_channel_id;
  if(!targetId)return;
  const guild=bot.guilds.cache.get(guildId);if(!guild)return;
  const channel=await guild.channels.fetch(targetId).catch(()=>null);
  if(!channel?.isTextBased()||typeof channel.send!=='function')return;
  const entry=new EmbedBuilder().setTitle(safe(title,256)).setColor(color(s)).setTimestamp().setFooter({text:signature()});
  if(fields.length)entry.addFields(fields.map(([name,value])=>({name:safe(name,256),value:logValue(value)||'—',inline:false})));
  const payload={embeds:[entry],allowedMentions:{parse:[]}};
  if(attachment)payload.files=[attachment];
  await channel.send(payload);
 }catch(e){console.warn(`[LOG ${kind}] ${guildId}: ${e.message}`);}
}
async function event(ticket,g,actor,type,details={}){
 await query('ticket_events',q=>q.insert({ticket_id:ticket,guild_id:g,actor_id:actor,event_type:type,details})).catch(e=>console.error('event:',e.message));
 if(EVENT_LABELS[type])void sendTicketLog(g,'general',EVENT_LABELS[type],[['Ticket',`#${ticket}`],['Responsável / ação de',actor?`<@${actor}> (${actor})`:'Sistema'],...Object.entries(details||{}).slice(0,6).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)])]);
}
async function send(i,msg){if(i.deferred)return i.editReply({content:msg});if(i.replied)return i.followUp({content:msg,flags:ephemeral});return i.reply({content:msg,flags:ephemeral});}
const CONFIG_AREAS=[
 {label:'Aparência e textos',value:'appearance',emoji:emoji('appearance'),description:'Título, descrição, cor e imagem'},
 {label:'Canais e equipe',value:'routing',emoji:emoji('routing'),description:'Categoria, logs e cargos'},
 {label:'Inteligência artificial',value:'ai',emoji:emoji('ai'),description:'Assistente, instruções e base de conhecimento'},
 {label:'Automações e limites',value:'automation',emoji:emoji('automation'),description:'Inatividade, avaliações e transcripts'},
 {label:'Departamentos',value:'departments',emoji:emoji('departments'),description:'Setores e formulários de abertura'},
 {label:'Publicar painel',value:'publish',emoji:emoji('publish'),description:'Publicar neste canal'},
 {label:'Estatísticas',value:'stats',emoji:emoji('stats'),description:'Indicadores do atendimento'}];
function menuConfig(){return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cfg:main').setPlaceholder('Selecione a área que deseja configurar').addOptions(CONFIG_AREAS)),new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:refresh').setLabel('Atualizar').setEmoji(emoji('repeat')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('cfg:emojis').setLabel('Instalar emojis').setEmoji(emoji('verify')).setStyle(ButtonStyle.Primary))];}
function configHome(s){return {embeds:[embed(`${icon('config')} • Central de configuração`,
 `**PAINEL DO SERVIDOR**\n> **Nome:** ${safe(s.panel_title,140)}\n> **IA:** ${s.ai_enabled?'Ativada':'Desativada'}\n> **Tickets por pessoa:** ${s.max_open_tickets}\n> **Transcripts HTML:** ${s.transcript_enabled?'Ativos':'Desativados'}\n\n**CONFIGURAÇÕES**\n> **Visual:** textos, cores e imagens\n> **Atendimento:** canais, equipe e departamentos\n> **Automação:** IA, limites e avaliações\n> **Publicação:** painel e estatísticas\n\nSelecione uma área no menu abaixo.`,s)],components:menuConfig()};}
function sectionNav(rows=[]){return [...rows,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:home').setLabel('Voltar').setEmoji(emoji('back')).setStyle(ButtonStyle.Secondary))];}
function routingView(s){return {embeds:[embed(`${icon('routing')} Canais e equipe`,'Configure o modo de abertura e o local dos tickets. Para logs e cargo, abra o submenu.',s)],components:[
 new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cfg:ticketmode').setPlaceholder(`Modo atual: ${s.ticket_mode==='thread'?'Tópico privado':'Canal privado'}`).addOptions([{label:'Canal privado (em categoria)',value:'channel',default:s.ticket_mode!=='thread'},{label:'Tópico privado (em canal)',value:'thread',default:s.ticket_mode==='thread'}])),
 new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg:channel:thread_parent_id').setPlaceholder('Canal-pai para tópicos privados').setChannelTypes(ChannelType.GuildText)),
 new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg:channel:category_id').setPlaceholder('Categoria dos tickets').setChannelTypes(ChannelType.GuildCategory)),
 new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:routing:stafflogs').setLabel('Logs e cargo da equipe').setStyle(ButtonStyle.Secondary)),
 ...sectionNav()]};}
function staffLogsView(s){return {embeds:[embed(`${icon('routing')} Logs e equipe`,
 `**Logs gerais:** ${s.log_channel_id?`<#${s.log_channel_id}>`:'Não configurado'}\n**Transcripts:** ${s.transcript_log_channel_id?`<#${s.transcript_log_channel_id}>`:'Usa logs gerais'}\n**Avaliações:** ${s.rating_log_channel_id?`<#${s.rating_log_channel_id}>`:'Usa logs gerais'}\n\nEscolha os canais abaixo. Se um canal específico não for selecionado, utiliza o canal de logs gerais.`,s)],components:[
 new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg:channel:log_channel_id').setPlaceholder('Logs gerais').setChannelTypes(ChannelType.GuildText)),
 new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg:channel:transcript_log_channel_id').setPlaceholder('Logs de transcripts HTML').setChannelTypes(ChannelType.GuildText)),
 new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg:channel:rating_log_channel_id').setPlaceholder('Logs de avaliações').setChannelTypes(ChannelType.GuildText)),
 new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg:role:staff_role_id').setPlaceholder('Cargo da equipe')),
 new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:routing:back').setLabel('Voltar').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('cfg:home').setLabel('Início').setStyle(ButtonStyle.Secondary))]};}
function configSaved(s,what){return {embeds:[embed('Configuração atualizada',`${what} salvo com sucesso. Use os botões abaixo para continuar.`,s)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:routing:back').setLabel('Canais e equipe').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('cfg:routing:stafflogs').setLabel('Logs e cargo').setStyle(ButtonStyle.Secondary)),...sectionNav()]};}
function field(id,label,value='',style=TextInputStyle.Short,required=true){const t=new TextInputBuilder().setCustomId(id).setLabel(safe(label,45)).setStyle(style).setRequired(required);if(value)t.setValue(safe(value,style===TextInputStyle.Paragraph?3500:300));return new ActionRowBuilder().addComponents(t);}
function modal(id,title,fields){return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields);}
function panelRows(ds){const items=ds.slice(0,25);return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:department').setPlaceholder('Selecione o setor de atendimento').addOptions(items.map(d=>({label:safe(d.name,100),description:safe(d.description,100)||undefined,value:String(d.id),...(d.emoji?{emoji:d.emoji}:{emoji:emoji('support')})}))))];}
async function publish(channel,g){const s=await settings(g),ds=await departments(g);if(!ds.length)throw Error('Crie pelo menos um departamento antes de publicar o painel.');const msg=await channel.send({embeds:[embed(s.panel_title,s.panel_description,s)],components:panelRows(ds)});await query('ticket_panels',q=>q.insert({guild_id:g,name:s.panel_title,channel_id:channel.id,message_id:msg.id,title:s.panel_title,description:s.panel_description}));return msg;}
function controls(){return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:staff').setLabel('Painel Staff').setEmoji(emoji('config')).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('ticket:member').setLabel('Painel Membros').setEmoji(emoji('member')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('ticket:close').setLabel('Encerrar (equipe)').setEmoji(emoji('close')).setStyle(ButtonStyle.Danger))];}
async function isStaff(i,s,d){return admin(i)||(s.staff_role_id&&i.member?.roles?.cache?.has(s.staff_role_id))||(d?.staff_role_id&&i.member?.roles?.cache?.has(d.staff_role_id));}
async function openTicket(i,dept,answers=[]){
 if(typeof answers==='string')answers=answers?[{label:'Solicitação',value:answers}]:[];
 const key=`${i.guildId}:${i.user.id}`;
 if(locks.has(key))return send(i,'Aguarde: seu ticket já está sendo criado.');
 locks.add(key);
 try{
  if(!i.deferred&&!i.replied)await i.deferReply({flags:ephemeral});
  const s=await settings(i.guildId);
  const blocked=await query('ticket_blacklist',q=>q.select('user_id').eq('guild_id',i.guildId).eq('user_id',i.user.id).maybeSingle());
  if(blocked)return i.editReply({content:'Você não tem permissão para abrir tickets neste servidor.',components:[]});
  const active=await query('tickets',q=>q.select('channel_id').eq('guild_id',i.guildId).eq('user_id',i.user.id).eq('status','open'));
  if(active.length>=Math.max(1,s.max_open_tickets))return i.editReply({content:`Limite de tickets simultâneos atingido (${s.max_open_tickets}).`,components:[]});
  const P=PermissionFlagsBits;
  const overwrites=[{id:i.guild.roles.everyone.id,deny:[P.ViewChannel]},{id:i.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles]},{id:bot.user.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.ManageChannels,P.EmbedLinks,P.AttachFiles]}];
  for(const role of new Set([s.staff_role_id,dept.staff_role_id].filter(Boolean)))if(i.guild.roles.cache.has(role))overwrites.push({id:role,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles]});
  const name=`ticket-${i.user.username.replace(/[^a-z0-9-]/gi,'').slice(0,12)||'usuario'}-${Date.now().toString(36).slice(-4)}`;
  let ch;
  if(s.ticket_mode==='thread'){
    const parent=await i.guild.channels.fetch(s.thread_parent_id).catch(()=>null);
    if(!parent||parent.type!==ChannelType.GuildText)throw Error('Configure um canal de texto válido em Canais e equipe para criar tópicos.');
    if(!parent.permissionsFor(bot.user)?.has([P.CreatePrivateThreads,P.SendMessagesInThreads,P.ManageThreads]))throw Error('O bot precisa de Criar tópicos privados, Enviar mensagens em tópicos e Gerenciar tópicos no canal escolhido.');
    ch=await parent.threads.create({name,type:ChannelType.PrivateThread,invitable:false,autoArchiveDuration:1440,reason:`Ticket de ${i.user.id}`});
    try{
      await ch.members.add(i.user.id);
      const roles=[s.staff_role_id,dept.staff_role_id].filter(Boolean);
      if(roles.length){
        const staff=i.guild.members.cache.filter(m=>!m.user.bot&&roles.some(r=>m.roles.cache.has(r)));
        for(const m of staff.values())await ch.members.add(m.id).catch(e=>console.warn('Adicionar staff ao tópico:',m.id,e.message));
      }
    }catch(e){await ch.delete().catch(()=>{});throw e;}
  }else{
    ch=await i.guild.channels.create({name,type:ChannelType.GuildText,parent:dept.category_id||s.category_id||undefined,permissionOverwrites:overwrites,topic:`Frio Tickets | cliente ${i.user.id} | setor ${dept.id}`,reason:`Ticket solicitado por ${i.user.id}`});
  }
  let ticket;
  try{ticket=await query('tickets',q=>q.insert({guild_id:i.guildId,channel_id:ch.id,user_id:i.user.id,department_id:dept.id,last_activity_at:stamp()}).select('*').single());}catch(e){await ch.delete().catch(()=>{});throw e;}
  await event(ticket.id,i.guildId,i.user.id,'opened',{department:dept.name});
  if(answers.length)query('tickets',q=>q.update({form_answers:answers}).eq('id',ticket.id)).catch(()=>{});
  const mention=dept.staff_role_id||s.staff_role_id;
  const e=embed(`Ticket #${ticket.id} • ${dept.name}`,s.welcome_text,s);
  if(answers.length){const per=Math.min(1024,Math.max(150,Math.floor(4500/answers.length)));e.addFields(answers.slice(0,10).map(a=>({name:safe(a.label,256),value:safe(a.value,per)||'—'})));}
  await ch.send({content:`<@${i.user.id}>${mention?` <@&${mention}>`:''}`,allowedMentions:{users:[i.user.id],roles:mention?[mention]:[]},embeds:[e],components:controls()});
  await i.editReply({content:`Atendimento criado: ${ch}`,components:[]});
 }finally{locks.delete(key);}}
async function transcript(channel,t,s,reason=''){if(!s.transcript_enabled)return null;const result=await buildTranscript(channel,t,{brand,signature,reason,limit:Math.max(100,Math.min(10000,Number(process.env.TRANSCRIPT_MAX_MESSAGES)||2000))});const html=result.html;const maxBytes=Number(process.env.TRANSCRIPT_DB_MAX_BYTES)||750000;if(Buffer.byteLength(html,'utf8')<=maxBytes){await query('ticket_transcripts',q=>q.upsert({ticket_id:t.id,guild_id:t.guild_id,content:html},{onConflict:'ticket_id'})).catch(e=>console.error('Transcript DB:',e.message));}else console.warn(`Transcript #${t.id} maior que limite do banco; arquivo HTML será enviado aos logs.`);return result;}
async function closeTicket(i,t,s,reason='Encerrado pela equipe'){if(!i.deferred&&!i.replied)await i.deferReply({flags:ephemeral});const content=await transcript(i.channel,t,s,reason).catch(e=>{console.error('Transcript:',e.message);return null;});await query('tickets',q=>q.update({status:'closed',closed_at:stamp(),close_reason:reason}).eq('id',t.id).eq('status','open'));await event(t.id,i.guildId,i.user.id,'closed',{reason});// Transcripts ficam em canal separado; logs gerais registram o fechamento via event().
 if(content){
  const buf=Buffer.from(content.html,'utf8');
  const attachment=buf.length<=8*1024*1024?new AttachmentBuilder(buf,{name:`transcript-ticket-${t.id}.html`}):null;
  await sendTicketLog(i.guildId,'transcript',`Transcript • Ticket #${t.id}`,[['Cliente',`<@${t.user_id}> (${t.user_id})`],['Encerrado por',`<@${i.user.id}> (${i.user.id})`],['Motivo',reason],['Data de abertura',t.created_at||'—'],['Encerrado em',stamp()],['Arquivo',attachment?'HTML anexado':'Arquivo acima do limite do Discord']],attachment);
 }else if(s.transcript_enabled){
  await sendTicketLog(i.guildId,'transcript',`Transcript indisponível • Ticket #${t.id}`,[['Cliente',t.user_id],['Motivo','Não foi possível gerar o HTML']]);
 }
 let dmOk=null;
 if(s.dm_rating_enabled||content){
  const payload={content:`Seu ticket #${t.id} em **${i.guild.name}** foi encerrado.\nMotivo: ${safe(reason,300)}${content?'\nSegue o transcript da conversa em anexo (abra o arquivo .html no navegador).':''}${s.dm_rating_enabled?'\n\nAvalie o atendimento:':''}`};
  if(content){const buf=Buffer.from(content.html,'utf8');if(buf.length<=8*1024*1024)payload.files=[new AttachmentBuilder(buf,{name:`transcript-ticket-${t.id}.html`})];}
  if(s.dm_rating_enabled)payload.components=[new ActionRowBuilder().addComponents([1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId(`rate:${t.id}:${n}`).setLabel(String(n)).setEmoji(emoji('like')).setStyle(ButtonStyle.Secondary)))];
  dmOk=await bot.users.fetch(t.user_id).then(u=>u.send(payload)).then(()=>true).catch(e=>{console.warn(`DM do ticket #${t.id}:`,e.message);return false;});
 }
 if(t.voice_channel_id)await i.guild.channels.delete(t.voice_channel_id,'Ticket encerrado').catch(()=>{});
 await i.editReply(`Ticket encerrado. O canal será removido em alguns segundos.${dmOk===false?'\nNão foi possível enviar o transcript por DM (mensagens diretas fechadas).':''}`);setTimeout(()=>i.channel.delete('Ticket encerrado').catch(()=>{}),5000);}
async function stats(g){const [tickets,ratings]=await Promise.all([query('tickets',q=>q.select('id,status,created_at').eq('guild_id',g).limit(1000)),query('ticket_ratings',q=>q.select('score').eq('guild_id',g).limit(1000))]);const avg=ratings.length?(ratings.reduce((a,b)=>a+b.score,0)/ratings.length).toFixed(2):'Sem avaliações';return `Tickets registrados (até 1000): **${tickets.length}**\nAbertos: **${tickets.filter(t=>t.status==='open').length}**\nEncerrados: **${tickets.filter(t=>t.status==='closed').length}**\nAvaliação média: **${avg}**`;}
const cmds=[
 new SlashCommandBuilder().setName('ticket').setDescription('Central de tickets FrioBots')
  .addSubcommand(x=>x.setName('config').setDescription('Configurações do servidor'))
  .addSubcommand(x=>x.setName('painel').setDescription('Publicar painel neste canal'))
  .addSubcommand(x=>x.setName('estatisticas').setDescription('Indicadores de atendimento'))
  .addSubcommand(x=>x.setName('ajuda').setDescription('Ajuda e comandos do sistema'))
  .addSubcommand(x=>x.setName('respostas').setDescription('Status das respostas automáticas e configuração')),
 new SlashCommandBuilder().setName('convidar').setDescription('Link para adicionar o Frio Tickets a outro servidor'),
 new SlashCommandBuilder().setName('call').setDescription('Mantém o bot em uma call de voz (entrar/sair)').setDMPermission(false),
 new SlashCommandBuilder().setName('dev').setDescription('Ferramentas globais FrioBots')
  .addSubcommand(x=>x.setName('ticket').setDescription('Central exclusiva do desenvolvedor'))
].map(x=>x.toJSON());
const startedAt=Date.now();
const helpText=()=>`**Frio Tickets • Comandos** (${VERSION_LABEL})\n**Slash:** /ticket config, /ticket painel, /ticket estatisticas, /ticket ajuda, /convidar, /call, /dev ticket\n**Prefixo (${PREFIX}):** ${['add @usuário','rem @usuário','fechar','assumir','renomear nome','prioridade baixa|normal|alta|urgente','mover @usuário #call','bloquear @usuário','desbloquear @usuário'].map(x=>'`'+PREFIX+x+'`').join(' • ')}\n\nPowered by FrioMortal`;
const diagnostics=()=>`**Diagnóstico global**\n> **Versão:** ${VERSION_LABEL}\n> **Bot:** ${bot.user?.tag||'desconectado'}\n> **Servidores:** ${bot.guilds.cache.size}\n> **Uptime:** ${Math.floor((Date.now()-startedAt)/60000)} minutos\n> **Ping:** ${bot.ws.ping} ms\n> **Memória:** ${Math.round(process.memoryUsage().rss/1024/1024)} MB\n> **Node.js:** ${process.version}\n> **Cache:** ${cache.size} servidores\n> **IA:** Local (sem API externa de IA) • conhecimento no Supabase`;


async function departmentsView(g){
 const s=await settings(g),ds=await departments(g);
 const lines=ds.map(d=>{const n=getQuestions(d).length;return `**#${d.id} • ${safe(d.name,60)}** — ${safe(d.description,60)||'sem descrição'} • ${n?`${n} pergunta${n>1?'s':''}`:'sem formulário'}`;});
 const rows=[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:modal:department').setLabel('Criar departamento').setEmoji(emoji('add')).setStyle(ButtonStyle.Success))];
 if(ds.length){
  rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('fm:pick').setPlaceholder('Gerenciar formulário do departamento').addOptions(ds.slice(0,25).map(d=>({label:safe(d.name,100),value:String(d.id),emoji:emoji('edit')})))));
  rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cfg:department:delete').setPlaceholder('Desativar departamento').addOptions(ds.slice(0,25).map(d=>({label:safe(d.name,100),value:String(d.id),emoji:emoji('delete')})))));
 }
 return {embeds:[embed(`${icon('departments')} Departamentos`,lines.length?lines.join('\n').slice(0,3500):'Nenhum departamento cadastrado.',s)],components:[...rows,...sectionNav()]};
}
const ctx={bot,db,query,settings,departments,departmentCache,event,admin,embed,safe,brand,signature,openTicket,panelRows,departmentsView};


registerCall(bot,{query});

bot.once('clientReady',async()=>{console.log(`${brand} ${VERSION_LABEL} online: ${bot.user.tag}`);restoreCalls().catch(e=>console.warn('[Call] restauração:',e.message));await loadGlobalBrand().catch(e=>console.error('Marca global:',e.message));try{bot.user.setActivity(globalBrand.activity_text);}catch(e){console.error("Atividade inicial:",e.message);}if(process.env.REGISTER_COMMANDS!=='false')try{await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),{body:cmds});console.log('Comandos registrados.');}catch(e){console.error('Falha no registro de comandos:',e);}if(process.env.AUTO_SYNC_EMOJIS==='true'){for(const guild of bot.guilds.cache.values()){try{const r=await syncGuildEmojis(guild);console.log(`[Emojis] ${guild.id}: +${r.created}, existentes ${r.skipped}, falhas ${r.failed.length}`);}catch(e){console.warn(`[Emojis] ${guild.id}: ${e.message}`);}await new Promise(resolve=>setTimeout(resolve,1500));}}});
bot.on('guildCreate',async guild=>{if(process.env.AUTO_SYNC_EMOJIS!=='true')return;try{await syncGuildEmojis(guild);}catch(e){console.warn(`[Emojis] ${guild.id}: ${e.message}`);}});
bot.on('interactionCreate',async i=>{
 const started=performance.now();
 if(PERF_LOG){
  const record=()=>console.log(`[PERF] ${i.customId||i.commandName||'interaction'} ack=${Math.round(performance.now()-started)}ms guild=${i.guildId||'dm'}`);
  i.client.rest; // No network work here; timing only.
  const originalReply=i.reply.bind(i),originalUpdate=i.update?.bind(i),originalDeferReply=i.deferReply.bind(i),originalDeferUpdate=i.deferUpdate?.bind(i),originalShowModal=i.showModal?.bind(i);
  let recorded=false;const mark=()=>{if(!recorded){recorded=true;record();}};
  i.reply=(...args)=>{mark();return originalReply(...args);};
  if(originalUpdate)i.update=(...args)=>{mark();return originalUpdate(...args);};
  i.deferReply=(...args)=>{mark();return originalDeferReply(...args);};
  if(originalDeferUpdate)i.deferUpdate=(...args)=>{mark();return originalDeferUpdate(...args);};
  if(originalShowModal)i.showModal=(...args)=>{mark();return originalShowModal(...args);};
 }
 try{
if(await handleTicketUI(i,ctx))return;
if(await handleCall(i,ctx))return;
if(i.isChatInputCommand()){
if(i.commandName==='convidar')return i.reply({...inviteMessage(),flags:ephemeral});
if(i.commandName==='dev'){if(!devOnly(i))return send(i,'Acesso restrito ao desenvolvedor.');return i.reply({...devPanel(),flags:ephemeral});}
if(!i.inGuild())return send(i,'Disponível apenas em servidores.');const sub=i.options.getSubcommand();if(sub==='config'){if(!admin(i))return send(i,'Somente administradores podem configurar.');await i.deferReply({flags:ephemeral});return i.editReply(configHome(await settings(i.guildId)));}
if(sub==='painel'){if(!admin(i))return send(i,'Acesso negado.');await i.deferReply({flags:ephemeral});const msg=await publish(i.channel,i.guildId);return i.editReply(`Painel publicado: ${msg.url}`);}
if(sub==='respostas'){if(!admin(i))return send(i,'Acesso negado.');const s=await settings(i.guildId);return i.reply({content:`**Respostas automáticas**\nStatus: ${s.ai_enabled?'ativado':'desativado'} (controle em /ticket config → Inteligência artificial)\nPerguntas disponíveis no Supabase: ${await knowledge.count(i.guildId)}\nImagens: identifica anexos e solicita descrição; não interpreta pixels\n\nPara cadastrar uma resposta no Supabase, abra **Instruções e conhecimento** e adicione pares neste formato:\n\`Pergunta: Qual o prazo do meu produto?\`\n\`Resposta: Consulte o prazo informado na compra ou fale com a equipe.\`\n\nO motor de respostas funciona sem API de IA.`,flags:ephemeral});}
if(sub==='ajuda')return i.reply({content:helpText(),flags:ephemeral});
if(sub==='estatisticas'){if(!admin(i))return send(i,'Acesso negado.');await i.deferReply({flags:ephemeral});return i.editReply({embeds:[embed(`${icon('stats')} Estatísticas`,await stats(i.guildId),await settings(i.guildId))]});}

}
if((i.isButton()||i.isModalSubmit())&&i.customId.startsWith('dev:')){
 if(!devOnly(i))return send(i,'Acesso restrito ao desenvolvedor.');
 if(i.isButton()){
  if(['dev:refresh','dev:home'].includes(i.customId))return i.update(devPanel());
  if(i.customId==='dev:invite')return i.update({...inviteMessage(),components:[...inviteMessage().components,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary))]});
  if(i.customId==='dev:diagnostics')return i.update({embeds:[embed('Diagnóstico • Frio Tickets',diagnostics())],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary))]});
  if(i.customId==='dev:servers'){const names=[...bot.guilds.cache.values()].slice(0,30).map(g=>`• ${safe(g.name,60)} (${g.id})`).join('\n');return i.update({embeds:[embed('Servidores conectados',names||'Nenhum servidor.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary))]});}
  if(i.customId==='dev:cache'){cache.clear();departmentCache.clear();clearKnowledge();return i.update({embeds:[embed('Cache limpo','As configurações serão recarregadas do Supabase quando necessárias.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary))]});}
  if(i.customId==='dev:test_ai'){
   await i.deferReply({flags:ephemeral});
   const examples=['como abrir ticket','pagamento nao caiu','meu bot nao responde'];
   const results=await Promise.all(examples.map(async q=>`${q}: ${(await knowledge.answer(i.guildId||bot.guilds.cache.first()?.id,q))?.answer||'sem resposta'}`));
   return i.editReply(`**Motor local ativo** • conhecimento no Supabase • sem API de IA\n\n${safe(results.join('\n'),1750)}`);
  }
  if(i.customId==='dev:sync_commands'){await i.deferUpdate();await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),{body:cmds});return i.editReply(devPanel());}
  if(i.customId==='dev:sync_emojis'){await i.deferReply({flags:ephemeral});let created=0,failed=0;for(const g of bot.guilds.cache.values()){try{const r=await syncGuildEmojis(g);created+=r.created;failed+=r.failed.length;}catch{failed++;}}return i.editReply(`Emojis sincronizados: ${created} novos; ${failed} falhas.`);}

  if(i.customId==='dev:profile')return i.showModal(modal('dev:save_profile','Perfil do bot',[field('username','Nome do bot',bot.user.username),field('avatar','URL HTTPS do avatar (opcional)','',TextInputStyle.Short,false),field('about','Descrição pública (opcional)','',TextInputStyle.Paragraph,false),field('activity','Status / atividade',globalBrand.activity_text)]));
  if(i.customId==='dev:signature')return i.showModal(modal('dev:save_signature','Assinatura global',[field('signature','Texto da assinatura',signature())]));
  if(i.customId==='dev:banner')return i.showModal(modal('dev:save_banner','Banner global por URL',[field('url','URL HTTPS da imagem ou GIF',globalBrand.banner_url||'')]));
  if(i.customId==='dev:toggle_banner'){await i.deferUpdate();await persistGlobalBrand({banner_visible:!globalBrand.banner_visible});return i.editReply(devPanel());}
 }
 if(i.isModalSubmit()){
  const get=k=>i.fields.getTextInputValue(k).trim();
  if(i.customId==='dev:save_signature'){const value=get('signature');if(!value||value.length>180)return send(i,'A assinatura deve ter entre 1 e 180 caracteres.');await i.deferReply({flags:ephemeral});await persistGlobalBrand({signature:value});return i.editReply(devPanel());}
  if(i.customId==='dev:save_banner'){const value=get('url');if(!isHttpsUrl(value))return send(i,'Informe uma URL HTTPS válida de imagem ou GIF.');await i.deferReply({flags:ephemeral});await persistGlobalBrand({banner_url:value,banner_visible:true});return i.editReply(devPanel());}
  if(i.customId==='dev:save_profile'){
   const name=get('username'),avatar=get('avatar'),about=get('about'),activity=get('activity');
   if(name.length<2||name.length>32||activity.length>128||!activity)return send(i,'Nome deve ter 2–32 caracteres e atividade 1–128.');
   if(avatar&&!isHttpsUrl(avatar))return send(i,'Avatar precisa ser uma URL HTTPS válida.');
   await i.deferReply({flags:ephemeral});
   const outcomes=[];
   if(name!==bot.user.username){try{await bot.user.setUsername(name);outcomes.push('Nome atualizado');}catch(e){outcomes.push(`Nome não alterado: ${safe(e.message,120)}`);}}
   if(avatar){try{await bot.user.setAvatar(avatar);outcomes.push('Avatar atualizado');}catch(e){outcomes.push(`Avatar não alterado: ${safe(e.message,120)}`);}}
   if(about){try{await bot.application.edit({description:about.slice(0,400)});outcomes.push('Descrição atualizada');}catch(e){outcomes.push(`Descrição não alterada: ${safe(e.message,120)}`);}}
   await persistGlobalBrand({activity_text:activity});try{bot.user.setActivity(activity);}catch(e){console.error("Atividade do perfil:",e.message);}
   return i.editReply(`Perfil processado.\n${outcomes.join('\n')||'Atividade atualizada.'}\nAtividade: ${activity}`);
  }
 }
}
if(i.isButton()&&i.customId==='cfg:emojis'){
 if(!i.inGuild()||!admin(i))return send(i,'Apenas administradores do servidor podem instalar emojis.');
 await i.deferReply({flags:ephemeral});
 const result=await syncGuildEmojis(i.guild);
 return i.editReply(`Emojis: **${result.created} instalados**, **${result.skipped} já existentes**, **${result.failed.length} falharam** (total ${result.total}).${result.failed.length?'\nFalhas: '+safe(result.failed.slice(0,6).join(' | '),900):''}`);
}
if(i.isButton()&&['cfg:home','cfg:refresh'].includes(i.customId)){if(!admin(i))return send(i,'Acesso negado.');if(i.customId==='cfg:refresh')cache.delete(i.guildId);await i.deferUpdate();return i.editReply(configHome(await settings(i.guildId)));}
if(i.isStringSelectMenu()&&i.customId==='cfg:main'){if(!admin(i))return send(i,'Acesso negado.');const v=i.values[0];if(!['appearance','automation'].includes(v))await i.deferUpdate();const s=cache.get(i.guildId)?.data||await settings(i.guildId);if(v==='publish'){/* acknowledged before database work */const msg=await publish(i.channel,i.guildId);return i.followUp({content:`Painel publicado: ${msg.url}`,flags:ephemeral});}if(v==='stats'){/* acknowledged before database work */return i.editReply({embeds:[embed(`${icon('stats')} Estatísticas`,await stats(i.guildId),s)],components:sectionNav()});}if(v==='appearance')return i.showModal(modal('cfg:save:appearance','Aparência do painel',[field('title','Título',s.panel_title),field('description','Descrição',s.panel_description,TextInputStyle.Paragraph),field('color','Cor HEX (ex: #5865F2)',s.brand_color),field('image','URL da imagem (opcional)',s.image_url||'',TextInputStyle.Short,false)]));if(v==='ai')return i.editReply({embeds:[embed(`${icon('ai')} Inteligência artificial`,`Status: **${s.ai_enabled?'Ativada':'Desativada'}**\nUse os botões para configurar a IA.`,s)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:toggle:ai_enabled').setLabel(s.ai_enabled?'Desativar IA':'Ativar IA').setEmoji(emoji(s.ai_enabled?'disable':'enable')).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('cfg:modal:ai').setLabel('Instruções e conhecimento').setEmoji(emoji('edit')).setStyle(ButtonStyle.Secondary)),...sectionNav()]});if(v==='automation')return i.showModal(modal('cfg:save:automation','Automações',[field('limit','Limite de tickets por usuário',String(s.max_open_tickets)),field('hours','Inatividade em horas (0 desativa)',String(s.inactivity_hours)),field('transcript','Transcrições (sim/não)',s.transcript_enabled?'sim':'não'),field('rating','Avaliação por DM (sim/não)',s.dm_rating_enabled?'sim':'não')]));if(v==='routing')return i.editReply(routingView(s));if(v==='departments')return i.editReply(await departmentsView(i.guildId));}
if(i.isButton()&&['cfg:routing:stafflogs','cfg:routing:back'].includes(i.customId)){
 if(!admin(i))return send(i,'Acesso negado.');
 await i.deferUpdate();const s=await settings(i.guildId);
 return i.editReply(i.customId==='cfg:routing:back'?routingView(s):staffLogsView(s));
}
if(i.isStringSelectMenu()&&i.customId==='cfg:ticketmode'){if(!admin(i))return send(i,'Acesso negado.');await i.deferUpdate();await save(i.guildId,{ticket_mode:i.values[0]});return i.editReply(routingView(await settings(i.guildId)));}
if(i.isChannelSelectMenu()&&i.customId.startsWith('cfg:channel:')){if(!admin(i))return send(i,'Acesso negado.');const key=i.customId.split(':')[2];if(!['category_id','log_channel_id','transcript_log_channel_id','rating_log_channel_id','thread_parent_id'].includes(key))return send(i,'Campo inválido.');await i.deferUpdate();await save(i.guildId,{[key]:i.values[0]});return i.editReply(['log_channel_id','transcript_log_channel_id','rating_log_channel_id'].includes(key)?staffLogsView(await settings(i.guildId)):configSaved(await settings(i.guildId),'Canal'));}
if(i.isRoleSelectMenu()&&i.customId==='cfg:role:staff_role_id'){if(!admin(i))return send(i,'Acesso negado.');await i.deferUpdate();await save(i.guildId,{staff_role_id:i.values[0]});return i.editReply(staffLogsView(await settings(i.guildId)));}
if(i.isStringSelectMenu()&&i.customId==='cfg:department:delete'){if(!admin(i))return send(i,'Acesso negado.');await i.deferUpdate();await query('ticket_departments',q=>q.update({enabled:false}).eq('guild_id',i.guildId).eq('id',Number(i.values[0])));departmentCache.delete(i.guildId);return i.editReply({embeds:[embed('Configuração atualizada', 'Departamento desativado. Publique um novo painel para atualizar as opções.',await settings(i.guildId))],components:sectionNav()});}
if(i.isButton()&&i.customId.startsWith('cfg:toggle:')){if(!admin(i))return send(i,'Acesso negado.');await i.deferUpdate();const s=await settings(i.guildId);await save(i.guildId,{ai_enabled:!s.ai_enabled});return i.editReply({embeds:[embed('Inteligência artificial',`IA ${!s.ai_enabled?'ativada':'desativada'}.`,await settings(i.guildId))],components:sectionNav()});}
if(i.isButton()&&i.customId==='cfg:modal:ai'){if(!admin(i))return send(i,'Acesso negado.');const s=await settings(i.guildId);return i.showModal(modal('cfg:save:ai','Configuração da IA',[field('prompt','Personalidade e instruções',s.ai_prompt,TextInputStyle.Paragraph),field('knowledge','Novo par Pergunta / Resposta', '',TextInputStyle.Paragraph,false)]));}
if(i.isButton()&&i.customId==='cfg:modal:department'){if(!admin(i))return send(i,'Acesso negado.');return i.showModal(modal('cfg:save:department','Novo departamento',[field('name','Nome do departamento'),field('description','Descrição curta','',TextInputStyle.Short,false),field('question','Pergunta inicial (vazio = sem formulário)','',TextInputStyle.Short,false),field('category','ID da categoria (opcional)','',TextInputStyle.Short,false),field('role','ID do cargo da equipe (opcional)','',TextInputStyle.Short,false)]));}
if(i.isModalSubmit()&&i.customId.startsWith('cfg:save:')){if(!admin(i))return send(i,'Acesso negado.');await i.deferReply({flags:ephemeral});const type=i.customId.split(':')[2],get=k=>i.fields.getTextInputValue(k).trim();if(type==='appearance'){const hex=get('color');if(!/^#[0-9a-f]{6}$/i.test(hex))return send(i,'Cor inválida. Use #RRGGBB.');if(get('image')&&!/^https:\/\//i.test(get('image')))return send(i,'Imagem precisa usar HTTPS.');await save(i.guildId,{panel_title:safe(get('title'),200),panel_description:safe(get('description'),2000),brand_color:hex,image_url:get('image')||null});return send(i,'Aparência salva. Publique um novo painel para aplicar.');}if(type==='ai'){
 const input=get('knowledge');
 const parsed=[...input.matchAll(/(?:^|\n)\s*Pergunta:\s*(.+)\n\s*Resposta:\s*([^\n]+)/gi)];
 let added=0;
 for(const match of parsed)if(await knowledge.teach(i.guildId,match[1],match[2],i.user.id,'manual'))added++;
 await save(i.guildId,{ai_prompt:get('prompt')});
 return send(i,`Instruções salvas. ${added} resposta(s) adicionada(s) ao Supabase.${input&&!added?' Verifique o formato Pergunta: / Resposta: e evite dados privados.':''}`);
 }if(type==='automation'){const limit=Number(get('limit')),hours=Number(get('hours'));if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(hours)||hours<0||hours>720)return send(i,'Valores inválidos: limite 1–20 e horas 0–720.');const yes=v=>['sim','s','true'].includes(v.toLowerCase());await save(i.guildId,{max_open_tickets:limit,inactivity_hours:hours,transcript_enabled:yes(get('transcript')),dm_rating_enabled:yes(get('rating'))});return send(i,'Automações e limites salvos.');}if(type==='department'){const category=get('category'),role=get('role');if(category&&!i.guild.channels.cache.has(category))return send(i,'Categoria não encontrada.');if(role&&!i.guild.roles.cache.has(role))return send(i,'Cargo não encontrado.');const ds=await departments(i.guildId);if(ds.length>=25)return send(i,'Limite de 25 departamentos por painel.');const base={guild_id:i.guildId,name:safe(get('name'),100),description:safe(get('description'),100),form_question:safe(get('question'),100)||'Descreva sua solicitação',category_id:category||null,staff_role_id:role||null,sort_order:ds.length};const q1=safe(get('question'),45);try{await query('ticket_departments',q=>q.insert({...base,form_questions:q1?[{label:q1,placeholder:'',style:'paragraph',required:true}]:[]}));}catch(e){if(!/form_questions/.test(e.message))throw e;await query('ticket_departments',q=>q.insert(base));}departmentCache.delete(i.guildId);return send(i,'Departamento criado. Publique um painel para disponibilizá-lo.');}}
if(i.isButton()&&i.customId.startsWith('rate:')){await i.deferUpdate();const [,id,score]=i.customId.split(':');const t=await query('tickets',q=>q.select('id,user_id,guild_id,claimed_by').eq('id',Number(id)).maybeSingle());if(!t||t.user_id!==i.user.id)return send(i,'Avaliação não autorizada.');await query('ticket_ratings',q=>q.upsert({ticket_id:t.id,guild_id:t.guild_id,user_id:i.user.id,score:Number(score)},{onConflict:'ticket_id'}));
 await sendTicketLog(t.guild_id,'rating',`Nova avaliação • Ticket #${t.id}`,[['Nota',`${score}/5`],['Cliente',`<@${i.user.id}> (${i.user.id})`],['Quem assumiu',t.claimed_by?`<@${t.claimed_by}> (${t.claimed_by})`:'Não assumido'],['Ticket',`#${t.id}`],['Data',stamp()]]);
 return i.editReply({content:`Obrigado pela avaliação: ${score}/5!`,components:[]});}
if(i.isButton()&&i.customId.startsWith('ticket:')){if(!i.inGuild())return send(i,'Apenas em servidores.');if(i.customId==='ticket:close'){const t=await query('tickets',q=>q.select('*').eq('channel_id',i.channelId).eq('status','open').maybeSingle());if(!t)return send(i,'Ticket não encontrado.');const ss=await settings(i.guildId),dd=t.department_id?await query('ticket_departments',q=>q.select('*').eq('id',t.department_id).maybeSingle()):null;if(!await isStaff(i,ss,dd))return send(i,'Somente a equipe pode encerrar tickets.');return i.showModal(modal('ticket:close:channel','Encerrar atendimento',[field('reason','Motivo do encerramento','Atendimento concluído',TextInputStyle.Paragraph)]));}await i.deferReply({flags:ephemeral});const t=await query('tickets',q=>q.select('*').eq('channel_id',i.channelId).eq('status','open').maybeSingle());if(!t)return send(i,'Ticket não encontrado ou encerrado.');const s=await settings(i.guildId),d=t.department_id?await query('ticket_departments',q=>q.select('*').eq('id',t.department_id).maybeSingle()):null,staff=await isStaff(i,s,d);if(i.customId==='ticket:claim'){if(!staff)return send(i,'Apenas a equipe pode assumir.');await query('tickets',q=>q.update({claimed_by:i.user.id}).eq('id',t.id));cancelPendingAi(i.channelId);await event(t.id,i.guildId,i.user.id,'claimed');await i.editReply('Você assumiu este atendimento.');return i.channel.send({content:`Atendimento assumido por <@${i.user.id}>.`,allowedMentions:{parse:[]}});}if(i.customId==='ticket:priority'){if(!staff)return send(i,'Apenas a equipe pode definir prioridade.');const priority=t.priority==='normal'?'alta':'normal';await query('tickets',q=>q.update({priority}).eq('id',t.id));await event(t.id,i.guildId,i.user.id,'priority',{priority});return send(i,`Prioridade alterada para **${priority}**.`);}}
if(i.isModalSubmit()&&i.customId.startsWith('ticket:close:')){await i.deferReply({flags:ephemeral});const t=await query('tickets',q=>q.select('*').eq('channel_id',i.channelId).eq('status','open').maybeSingle());if(!t)return send(i,'Ticket já encerrado.');const s=await settings(i.guildId),d=t.department_id?await query('ticket_departments',q=>q.select('*').eq('id',t.department_id).maybeSingle()):null;if(!await isStaff(i,s,d))return send(i,'Somente a equipe pode encerrar tickets.');return closeTicket(i,t,s,i.fields.getTextInputValue('reason'));}
if(i.isMessageComponent()||i.isModalSubmit())return send(i,'Esta ação não está disponível nesta versão. Atualize o painel e tente novamente.');
}catch(e){console.error('Erro na interação:',e);const msg=`Não foi possível concluir a ação: ${safe(e.message,140)}`;if(i.deferred&&!i.replied)await i.editReply({content:msg,embeds:[],components:[]}).catch(()=>{});else if(i.replied)await i.followUp({content:msg,flags:ephemeral}).catch(()=>{});else await i.reply({content:msg,flags:ephemeral}).catch(()=>{});}});
// Comandos de prefixo: atalhos administrativos; menus continuam em interações.
const PREFIX=process.env.BOT_PREFIX||'.';
const PREFIX_COMMANDS=new Set(['mover','add','adicionar','rem','remover','fechar','assumir','renomear','prioridade','bloquear','desbloquear']);
async function handlePrefix(m){
 if(!m.guild||m.author.bot||!PREFIX||!m.content.startsWith(PREFIX))return false;
 const parts=m.content.slice(PREFIX.length).trim().split(/\s+/);
 const cmd=(parts.shift()||'').toLowerCase();
 if(!PREFIX_COMMANDS.has(cmd))return false;
 const permitted=m.member?.permissions.has(PermissionFlagsBits.Administrator)||devs.has(m.author.id);
 const reply=content=>m.reply({content,allowedMentions:{repliedUser:false,parse:[]}});
 const s=await settings(m.guild.id);
 const t=await query('tickets',q=>q.select('*').eq('channel_id',m.channel.id).eq('status','open').maybeSingle());
 const d=t?.department_id?await query('ticket_departments',q=>q.select('*').eq('id',t.department_id).maybeSingle()):null;
 const staff=permitted||Boolean((s.staff_role_id&&m.member.roles.cache.has(s.staff_role_id))||(d?.staff_role_id&&m.member.roles.cache.has(d.staff_role_id)));
 if(cmd==='mover'){
  if(!(staff||m.member.permissions.has(PermissionFlagsBits.MoveMembers))){await reply('Apenas a equipe pode mover pessoas.');return true;}
  const usage=`Use \`${PREFIX}mover @usuário #canal-de-voz\`. Vários usuários e \`todos\` (todos da sua call) também funcionam; sem canal, move para a sua call.`;
  const ids=parts.map(x=>x.replace(/[<@!#&>]/g,'')).filter(x=>/^\d{15,22}$/.test(x));
  let dest=m.mentions.channels.find(c=>c.isVoiceBased());
  if(!dest)for(const id of ids){const c=m.guild.channels.cache.get(id);if(c?.isVoiceBased()){dest=c;break;}}
  if(!dest)dest=m.member.voice.channel||null;
  if(!dest){await reply(`Informe o canal de voz de destino. ${usage}`);return true;}
  if(!dest.permissionsFor(m.member)?.has(PermissionFlagsBits.ViewChannel)){await reply('Você não tem acesso a esse canal.');return true;}
  const botPerms=dest.permissionsFor(m.guild.members.me);
  if(!botPerms?.has(PermissionFlagsBits.MoveMembers)||!botPerms.has(PermissionFlagsBits.Connect)){await reply('Eu preciso das permissões **Mover Membros** e **Conectar** nesse canal.');return true;}
  const targets=new Map();
  if(parts.some(x=>x.toLowerCase()==='todos')){const from=m.member.voice.channel;if(!from){await reply('Entre em uma call para usar `todos`.');return true;}for(const [id,mm] of from.members)if(!mm.user.bot)targets.set(id,mm);}
  for(const mm of m.mentions.members?.values()||[])if(!mm.user.bot)targets.set(mm.id,mm);
  for(const id of ids){if(m.guild.channels.cache.has(id)||m.guild.roles.cache.has(id))continue;const mm=m.guild.members.cache.get(id)||await m.guild.members.fetch(id).catch(()=>null);if(mm&&!mm.user.bot)targets.set(mm.id,mm);}
  if(!targets.size){await reply(`Informe quem mover. ${usage}`);return true;}
  const moved=[],already=[],offline=[],failed=[];
  for(const mm of targets.values()){
   if(t?.voice_channel_id===dest.id)await dest.permissionOverwrites.edit(mm.id,{ViewChannel:true,Connect:true,Speak:true}).catch(()=>{});
   if(!mm.voice.channelId){offline.push(mm.id);continue;}
   if(mm.voice.channelId===dest.id){already.push(mm.id);continue;}
   await mm.voice.setChannel(dest,`Movido por ${m.author.tag}`).then(()=>moved.push(mm.id)).catch(()=>failed.push(mm.id));
  }
  const list=a=>a.map(x=>`<@${x}>`).join(', ');
  await reply([moved.length?`Movidos para ${dest}: ${list(moved)}`:'',already.length?`Já estavam em ${dest}: ${list(already)}`:'',offline.length?`Não estão em nenhuma call (o Discord só move quem já está em voz): ${list(offline)}`:'',failed.length?`Não consegui mover (cargo acima do meu ou sem permissão): ${list(failed)}`:''].filter(Boolean).join('\n'));
  return true;
 }
 if(['fechar','assumir','renomear','prioridade'].includes(cmd)){
  if(!t){await reply('Este comando só funciona em um ticket aberto.');return true;}
  if(!staff){await reply('Ação restrita à equipe de atendimento.');return true;}
  if(cmd==='assumir'){await query('tickets',q=>q.update({claimed_by:m.author.id}).eq('id',t.id));cancelPendingAi(m.channel.id);await event(t.id,m.guild.id,m.author.id,'claimed');await reply(`Atendimento assumido por <@${m.author.id}>.`);}
  if(cmd==='prioridade'){const value=(parts[0]||'').toLowerCase();if(!['baixa','normal','alta','urgente'].includes(value)){await reply('Use `.prioridade baixa|normal|alta|urgente`.');return true;}await query('tickets',q=>q.update({priority:value}).eq('id',t.id));await event(t.id,m.guild.id,m.author.id,'priority',{priority:value});await reply(`Prioridade: **${value}**.`);}
  if(cmd==='renomear'){const name=parts.join('-').toLowerCase().replace(/[^a-z0-9\-_]/g,'-').replace(/-+/g,'-').slice(0,85);if(!name){await reply('Use `.renomear novo-nome`.');return true;}await m.channel.setName(name);await event(t.id,m.guild.id,m.author.id,'rename',{name});await reply(`Canal renomeado para **${name}**.`);}
  if(cmd==='fechar'){await reply('Encerrando atendimento e gerando transcript...');const fake={guildId:m.guild.id,guild:m.guild,channel:m.channel,user:m.author,reply:async payload=>m.channel.send(payload),deferReply:async()=>{},editReply:async payload=>m.channel.send(payload)};await closeTicket(fake,t,s,'Encerrado pelo comando de prefixo');}
  return true;
 }
 const target=m.mentions.users.first()||m.guild.members.cache.get((parts[0]||'').replace(/[^0-9]/g,''))?.user;
 if(!target){await reply(`Informe um usuário: \`${PREFIX}${cmd} @usuário\`.`);return true;}
 if(!staff){await reply('Apenas a equipe de atendimento pode utilizar este comando.');return true;}
 if(['add','adicionar','rem','remover'].includes(cmd)){
  if(!t){await reply('Use este comando dentro de um ticket aberto.');return true;}
  const allow=['add','adicionar'].includes(cmd);
  await m.channel.permissionOverwrites.edit(target.id,{ViewChannel:allow,SendMessages:allow,ReadMessageHistory:allow});
  await event(t.id,m.guild.id,m.author.id,allow?'adicionar':'remover',{user:target.id});
  await reply(`Permissões ${allow?'concedidas':'removidas'} para <@${target.id}>.`);return true;
 }
 if(cmd==='bloquear'){
  await query('ticket_blacklist',q=>q.upsert({guild_id:m.guild.id,user_id:target.id},{onConflict:'guild_id,user_id'}));
  await reply(`Usuário <@${target.id}> bloqueado de abrir tickets.`);return true;
 }
 if(cmd==='desbloquear'){
  await query('ticket_blacklist',q=>q.delete().eq('guild_id',m.guild.id).eq('user_id',target.id));
  await reply(`Usuário <@${target.id}> desbloqueado.`);return true;
 }
 return true;
}

// O bot não se apresenta como funcionário humano: identifica-se como assistente automático.
async function answerPendingTicket(m,t){
 const key=m.channel.id;
 try{
  // Consulta o banco novamente antes de responder: o ticket pode ter sido assumido ou encerrado.
  const current=await query('tickets',q=>q.select('id,claimed_by,user_id').eq('id',t.id).eq('status','open').maybeSingle());
  if(!current||current.claimed_by||current.user_id!==m.author.id)return;
  const config=await settings(m.guild.id);
  if(!config.ai_enabled)return;
  if(Date.now()-(aiCooldown.get(key)||0)<8000)return;
  const img=imageAttachment(m),caption=String(m.content||'').trim();
  if(!caption&&!img)return;
  // A base de conhecimento do servidor tem prioridade sobre a informação pública.
  let response=caption?await knowledge.answer(m.guild.id,caption):null;
  let external=null;
  if(!response && caption && !img)external=await publicApiAnswer(m.guild.id,m.author.id,caption);
  // Se o atendimento foi assumido enquanto a API respondia, não envia a resposta.

  // Checagem final reduz o risco de uma resposta após a equipe assumir durante a consulta.
  const check=await query('tickets',q=>q.select('claimed_by').eq('id',t.id).eq('status','open').maybeSingle());
  if(!check||check.claimed_by)return;
  aiCooldown.set(key,Date.now());
  const opts={allowedMentions:{parse:[],repliedUser:false}};
  if(img){
   const status=await m.reply({...opts,content:'**Assistente automático • Analisando…**'}).catch(()=>null);
   if(!status)return;
   const output=response
    ?`${response.answer}\n\nRecebi a imagem, mas não consigo interpretar visualmente seu conteúdo. Descreva o que aparece para eu tentar ajudar.`
    :'Recebi sua imagem. Não consigo analisar seu conteúdo visual neste modo local. Descreva o print ou copie a mensagem de erro para que a equipe e eu possamos ajudar.';
   await status.edit({content:`**Assistente automático • Frio Tickets**\n${output}`,allowedMentions:{parse:[]}}).catch(()=>{});
   return;
  }
  if(response){await m.reply({...opts,content:`**Assistente automático • Frio Tickets**\n${response.answer}`});return;}
  if(external){await m.reply({...opts,content:`**Assistente automático • Consulta pública (${external.source})**\n${external.answer}`});return;}
  void knowledge.markUnanswered(m.guild.id,caption).catch(e=>console.warn('IA perguntas:',e.message));
  await m.reply({...opts,content:'**Assistente automático • Frio Tickets**\nAinda não tenho uma resposta confiável para isso. Pode detalhar sua dúvida? A equipe poderá assumir e continuar o atendimento.'});
 }catch(e){console.error('IA/atendimento:',e.message);}
}
function scheduleAutomaticReply(m,t){
 const key=m.channel.id;
 cancelPendingAi(key);
 const opened=Date.parse(t.created_at||'')||Date.now();
 const delay=Math.max(0,25000-(Date.now()-opened));
 if(delay===0){void answerPendingTicket(m,t);return;}
 const timer=setTimeout(()=>{
  if(pendingAi.get(key)?.timer!==timer)return;
  pendingAi.delete(key);
  void answerPendingTicket(m,t);
 },delay);
 timer.unref();
 pendingAi.set(key,{timer,ticketId:t.id});
}
const aiWarned=new Set();
const mentionCooldown=new Map();
bot.on('messageCreate',async m=>{
 if(!m.guild||m.author.bot)return;
 try{
  if(await handleServerLock(m,db))return;
  if(await handlePrefix(m))return;
  // Responde a menções diretas, inclusive fora dos tickets. Não consulta a IA nem o banco.
  if(bot.user && m.mentions.users.has(bot.user.id) && !m.mentions.everyone) {
   const key=`${m.guild.id}:${m.author.id}`;
   const now=Date.now();
   if(now-(mentionCooldown.get(key)||0)>15000) {
    mentionCooldown.set(key,now);
    await m.reply({content:'**Frio Tickets • Assistente automático**\nQual sua dúvida/problema? Descreva o que aconteceu para que eu possa ajudar.',allowedMentions:{parse:[],repliedUser:false}}).catch(e=>console.warn('Menção:',e.message));
   }
   return;
  }
  const t=await query('tickets',q=>q.select('id,user_id,claimed_by,department_id,created_at').eq('channel_id',m.channel.id).eq('status','open').maybeSingle());
  if(!t)return;
  await query('tickets',q=>q.update({last_activity_at:stamp()}).eq('id',t.id));
  // Aprendizado por servidor: a loja NÃO compartilha respostas com Frio Applications.
  // Apenas mensagens de equipe autorizada podem virar conhecimento; nunca conversas de clientes isoladas.
  if(m.author.id!==t.user_id){
   if(m.content?.trim() && !m.content.trim().startsWith('.') && !m.author.bot){
    const ss=await settings(m.guild.id);
    let authorized=Boolean(m.member?.permissions.has(PermissionFlagsBits.Administrator)||devs.has(m.author.id)||ss.staff_role_id&&m.member?.roles.cache.has(ss.staff_role_id)||t.claimed_by===m.author.id);
    if(!authorized && t.department_id){const dep=await query('ticket_departments',q=>q.select('staff_role_id').eq('id',t.department_id).maybeSingle());authorized=Boolean(dep?.staff_role_id&&m.member?.roles.cache.has(dep.staff_role_id));}
    if(authorized){
     let original=null;
     if(m.reference?.messageId){
      original=await m.channel.messages.fetch(m.reference.messageId).catch(()=>null);
     }else{
      // Sem usar Reply: só aprende se a mensagem imediatamente anterior for
      // uma pergunta recente do dono do ticket. Não tenta inferir diálogo ambíguo.
      const history=await m.channel.messages.fetch({limit:5,before:m.id}).catch(()=>null);
      const previous=history?.first();
      const question=String(previous?.content||'').trim();
      const looksLikeQuestion=/\?|^(?:como|qual|quais|quando|onde|porque|por que|quanto|quanto custa|posso|pode|tem|voc[eê]s|preciso|queria|gostaria|me ajuda|n[aã]o consigo)\b/i.test(question);
      if(previous?.author.id===t.user_id && m.createdTimestamp-previous.createdTimestamp<=120000 && looksLikeQuestion){original=previous;}
     }
     if(original?.author.id===t.user_id && original.content?.trim()){
      const learned=await knowledge.teach(m.guild.id,original.content,m.content,m.author.id,'staff');
      if(learned&&process.env.AI_LEARN_LOG==='true')console.log(`[IA] resposta aprendida guild=${m.guild.id}`);
     }
    }
   }
   return;
  }
  // Aguarda 25 s a partir da abertura; cada mensagem do cliente substitui a pendente.
  // Depois dos 25 s, responde imediatamente, até um membro da equipe assumir.
  if(t.claimed_by){cancelPendingAi(m.channel.id);return;}
  const s=await settings(m.guild.id);
  if(!s.ai_enabled)return;
  if(!String(m.content||'').trim()&&!imageAttachment(m))return;
  scheduleAutomaticReply(m,t);
 }catch(e){console.error('IA/mensagem:',e.message);}
});
// Canal do ticket apagado à mão: encerra o registro e remove o canal de voz associado.
const handleTicketRemoval=async ch=>{cancelPendingAi(ch.id);try{if(!ch.guild||![ChannelType.GuildText,ChannelType.PrivateThread].includes(ch.type))return;const t=await query('tickets',q=>q.select('id,voice_channel_id').eq('channel_id',ch.id).eq('status','open').maybeSingle());if(!t)return;await query('tickets',q=>q.update({status:'closed',closed_at:stamp(),close_reason:'Canal excluído manualmente'}).eq('id',t.id));if(t.voice_channel_id)await ch.guild.channels.delete(t.voice_channel_id,'Ticket removido').catch(()=>{});}catch(e){console.error('ticket removal:',e.message);}};
bot.on('channelDelete',handleTicketRemoval);
bot.on('threadDelete',handleTicketRemoval);
// Verificação leve de inatividade, sem varreduras pesadas ou deleções automáticas.
setInterval(async()=>{try{for(const g of bot.guilds.cache.values()){const s=await settings(g.id);if(!s.inactivity_hours)continue;const limit=new Date(Date.now()-s.inactivity_hours*3600000).toISOString();const old=await query('tickets',q=>q.select('id,channel_id').eq('guild_id',g.id).eq('status','open').lt('last_activity_at',limit).limit(10));for(const t of old){const key=`reminder:${t.id}`;if(Date.now()-(aiCooldown.get(key)||0)<3600000)continue;aiCooldown.set(key,Date.now());const ch=await g.channels.fetch(t.channel_id).catch(()=>null);if(ch?.isTextBased())await ch.send({content:'Este atendimento está inativo. Caso ainda precise de ajuda, envie uma mensagem para continuar.',allowedMentions:{parse:[]}}).catch(()=>{});}}}catch(e){console.error('Inatividade:',e.message);}},15*60*1000).unref();
process.on('unhandledRejection',e=>console.error('Unhandled:',e));process.on('SIGTERM',()=>{for(const key of pendingAi.keys())cancelPendingAi(key);bot.destroy();});bot.login(process.env.DISCORD_TOKEN);
