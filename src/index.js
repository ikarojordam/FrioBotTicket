/** Frio Tickets v3.1 — Desenvolvido por FrioBots • FrioStore */
import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, AttachmentBuilder } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { buildTranscript } from './transcript.js';
import { emoji, icon, bindEmojiClient } from './emojis.js';
import { syncGuildEmojis } from './emoji-sync.js';

const needed=['DISCORD_TOKEN','DISCORD_CLIENT_ID','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
for(const k of needed)if(!process.env[k])throw new Error(`Variável obrigatória ausente: ${k}`);
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}});
const bot=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
bindEmojiClient(bot);
const devs=new Set((process.env.DEV_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
const brand=process.env.BRAND_NAME||'Frio Tickets',fallbackSignature=process.env.BRAND_SIGNATURE||'Desenvolvido por FrioBots • FrioStore';
let globalBrand={signature:fallbackSignature,banner_url:process.env.BRAND_IMAGE_URL||null,banner_visible:false,activity_text:`${brand} • /ticket config`};
const signature=()=>globalBrand.signature;
async function loadGlobalBrand(){const row=await query('ticket_global_brand',q=>q.select('*').eq('id',1).maybeSingle());if(row)globalBrand={...globalBrand,...row};}
const isHttpsUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.hostname.length>3&&v.length<=2000;}catch{return false;}};
const devOnly=i=>devs.has(i.user.id);
const defaults={panel_title:'Central de Atendimento',panel_description:'Selecione o departamento para iniciar seu atendimento.',brand_color:'#5865F2',welcome_text:'Descreva sua solicitação para nossa equipe.',ai_enabled:false,ai_prompt:'Você é um atendente cordial e profissional. Se não souber, encaminhe a uma pessoa.',knowledge_base:'',max_open_tickets:2,inactivity_hours:0,transcript_enabled:true,dm_rating_enabled:true};
const cache=new Map(),locks=new Set(),aiCooldown=new Map();
const departmentCache=new Map();
const pendingSettings=new Map();
const pendingDepartments=new Map();
const CACHE_TTL_MS=Math.max(5000,Number(process.env.CACHE_TTL_MS)||60000);
const PERF_LOG=process.env.PERF_LOG==='true';

const stamp=()=>new Date().toISOString();
const color=s=>/^#[0-9a-f]{6}$/i.test(s?.brand_color||'')?parseInt(s.brand_color.slice(1),16):0x5865f2;
const embed=(title,description,s={})=>{const e=new EmbedBuilder().setTitle(title).setDescription(description||' ').setColor(color(s)).setFooter({text:signature()});if(s.image_url&&/^https:\/\//.test(s.image_url))e.setImage(s.image_url);else if(globalBrand.banner_visible&&isHttpsUrl(globalBrand.banner_url))e.setImage(globalBrand.banner_url);return e;};
const ephemeral=MessageFlags.Ephemeral;
function devPanel(){
 const status=globalBrand.banner_visible?'Ativo':'Oculto';
 const e=embed(`${icon('config')} • Central do desenvolvedor`,
 `**IDENTIDADE DO BOT**\n> **Nome:** ${bot.user?.username||brand}\n> **Atividade:** ${safe(globalBrand.activity_text,100)}\n> **Assinatura:** ${safe(signature(),160)}\n> **Banner:** ${status}\n\n**SISTEMA**\n> **Servidores:** ${bot.guilds.cache.size}\n> **Hospedagem:** Discloud • **Banco:** Supabase\n\nEscolha uma ferramenta abaixo para editar.`,{});
 e.setAuthor({name:'FRIO TICKETS • Administração global'});
 return {embeds:[e],components:[
 new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:profile').setLabel('Perfil').setEmoji(emoji('appearance')).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('dev:signature').setLabel('Assinaturas').setEmoji(emoji('edit')).setStyle(ButtonStyle.Secondary)),
 new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:banner').setLabel('Banner por URL').setEmoji(emoji('publish')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dev:toggle_banner').setLabel(globalBrand.banner_visible?'Ocultar banner':'Mostrar banner').setEmoji(emoji(globalBrand.banner_visible?'disable':'enable')).setStyle(ButtonStyle.Secondary)),
 new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:diagnostics').setLabel('Diagnóstico').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('dev:servers').setLabel('Servidores').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dev:cache').setLabel('Limpar cache').setStyle(ButtonStyle.Secondary)),
 new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:sync_commands').setLabel('Sincronizar /').setEmoji(emoji('repeat')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dev:sync_emojis').setLabel('Sincronizar emojis').setEmoji(emoji('verify')).setStyle(ButtonStyle.Secondary)),
 new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:refresh').setLabel('Atualizar informações').setEmoji(emoji('config')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setEmoji(emoji('back')).setStyle(ButtonStyle.Secondary))]};
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
async function event(ticket,g,actor,type,details={}){await query('ticket_events',q=>q.insert({ticket_id:ticket,guild_id:g,actor_id:actor,event_type:type,details})).catch(e=>console.error('event:',e.message));}
async function send(i,msg){if(i.deferred)return i.editReply({content:msg});if(i.replied)return i.followUp({content:msg,flags:ephemeral});return i.reply({content:msg,flags:ephemeral});}
const CONFIG_AREAS=[
 {label:'Aparência e textos',value:'appearance',emoji:emoji('appearance'),description:'Título, descrição, cor e imagem'},
 {label:'Canais e equipe',value:'routing',emoji:emoji('routing'),description:'Categoria, logs e cargos'},
 {label:'Inteligência artificial',value:'ai',emoji:emoji('ai'),description:'Assistente, instruções e base de conhecimento'},
 {label:'Automações e limites',value:'automation',emoji:emoji('automation'),description:'Inatividade, avaliações e transcripts'},
 {label:'Departamentos',value:'departments',emoji:emoji('departments'),description:'Setores e formulários de abertura'},
 {label:'Publicar painel',value:'publish',emoji:emoji('publish'),description:'Publicar neste canal'},
 {label:'Estatísticas',value:'stats',emoji:emoji('stats'),description:'Indicadores do atendimento'}];
function menuConfig(){return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cfg:main').setPlaceholder('Selecione a área que deseja configurar').addOptions(CONFIG_AREAS)),new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:home').setLabel('Voltar / início').setEmoji(emoji('back')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('cfg:refresh').setLabel('Atualizar').setEmoji(emoji('automation')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('cfg:emojis').setLabel('Instalar emojis').setEmoji(emoji('verify')).setStyle(ButtonStyle.Primary))];}
function configHome(s){return {embeds:[embed(`${icon('config')} • Central de configuração`,
 `**PAINEL DO SERVIDOR**\n> **Nome:** ${safe(s.panel_title,140)}\n> **IA:** ${s.ai_enabled?'Ativada':'Desativada'}\n> **Tickets por pessoa:** ${s.max_open_tickets}\n> **Transcripts HTML:** ${s.transcript_enabled?'Ativos':'Desativados'}\n\n**CONFIGURAÇÕES**\n> **Visual:** textos, cores e imagens\n> **Atendimento:** canais, equipe e departamentos\n> **Automação:** IA, limites e avaliações\n> **Publicação:** painel e estatísticas\n\nSelecione uma área no menu abaixo.`,s)],components:menuConfig()};}
function sectionNav(rows=[]){return [...rows,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:home').setLabel('Voltar').setEmoji(emoji('back')).setStyle(ButtonStyle.Secondary))];}
function field(id,label,value='',style=TextInputStyle.Short,required=true){return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setValue(safe(value,style===TextInputStyle.Paragraph?3500:300)).setRequired(required));}
function modal(id,title,fields){return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields);}
function panelRows(ds){const items=ds.slice(0,25);return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:department').setPlaceholder('Selecione o setor de atendimento').addOptions(items.map(d=>({label:safe(d.name,100),description:safe(d.description,100)||undefined,value:String(d.id),...(d.emoji?{emoji:d.emoji}:{emoji:emoji('support')})}))))];}
async function publish(channel,g){const s=await settings(g),ds=await departments(g);if(!ds.length)throw Error('Crie pelo menos um departamento antes de publicar o painel.');const msg=await channel.send({embeds:[embed(s.panel_title,s.panel_description,s)],components:panelRows(ds)});await query('ticket_panels',q=>q.insert({guild_id:g,name:s.panel_title,channel_id:channel.id,message_id:msg.id,title:s.panel_title,description:s.panel_description}));return msg;}
function controls(){return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:claim').setLabel('Assumir').setEmoji(emoji('claim')).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('ticket:priority').setLabel('Prioridade').setEmoji(emoji('priority')).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('ticket:close').setLabel('Encerrar').setEmoji(emoji('close')).setStyle(ButtonStyle.Danger))];}
async function isStaff(i,s,d){return admin(i)||(s.staff_role_id&&i.member.roles.cache.has(s.staff_role_id))||(d?.staff_role_id&&i.member.roles.cache.has(d.staff_role_id));}
async function openTicket(i,dept,answer){const key=`${i.guildId}:${i.user.id}`;if(locks.has(key))return send(i,'Aguarde: seu ticket já está sendo criado.');locks.add(key);try{if(!i.deferred&&!i.replied)await i.deferReply({flags:ephemeral});const s=await settings(i.guildId);const blocked=await query('ticket_blacklist',q=>q.select('user_id').eq('guild_id',i.guildId).eq('user_id',i.user.id).maybeSingle());if(blocked)return i.editReply('Você não tem permissão para abrir tickets neste servidor.');const active=await query('tickets',q=>q.select('channel_id').eq('guild_id',i.guildId).eq('user_id',i.user.id).eq('status','open'));if(active.length>=Math.max(1,s.max_open_tickets))return i.editReply(`Limite de tickets simultâneos atingido (${s.max_open_tickets}).`);
const overwrites=[{id:i.guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},{id:i.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},{id:bot.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]}];for(const role of new Set([s.staff_role_id,dept.staff_role_id].filter(Boolean)))if(i.guild.roles.cache.has(role))overwrites.push({id:role,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
const ch=await i.guild.channels.create({name:`ticket-${i.user.username.replace(/[^a-z0-9-]/gi,'').slice(0,12)||'usuario'}-${Date.now().toString(36).slice(-4)}`,type:ChannelType.GuildText,parent:dept.category_id||s.category_id||undefined,permissionOverwrites:overwrites,topic:`Frio Tickets | cliente ${i.user.id} | setor ${dept.id}`,reason:`Ticket solicitado por ${i.user.id}`});let ticket;try{ticket=await query('tickets',q=>q.insert({guild_id:i.guildId,channel_id:ch.id,user_id:i.user.id,department_id:dept.id,last_activity_at:stamp()}).select('*').single());}catch(e){await ch.delete().catch(()=>{});throw e;}await event(ticket.id,i.guildId,i.user.id,'opened',{department:dept.name});const mention=dept.staff_role_id||s.staff_role_id;await ch.send({content:`<@${i.user.id}>${mention?` <@&${mention}>`:''}`,allowedMentions:{users:[i.user.id],roles:mention?[mention]:[]},embeds:[embed(`Ticket #${ticket.id} • ${dept.name}`,`${s.welcome_text}${answer?`\n\n**Solicitação:** ${safe(answer,1800)}`:''}`,s)],components:controls()});await i.editReply(`Atendimento criado: ${ch}`);}finally{locks.delete(key);}}
async function transcript(channel,t,s,reason=''){if(!s.transcript_enabled)return null;const result=await buildTranscript(channel,t,{brand,signature,reason,limit:Math.max(100,Math.min(10000,Number(process.env.TRANSCRIPT_MAX_MESSAGES)||2000))});const html=result.html;const maxBytes=Number(process.env.TRANSCRIPT_DB_MAX_BYTES)||750000;if(Buffer.byteLength(html,'utf8')<=maxBytes){await query('ticket_transcripts',q=>q.upsert({ticket_id:t.id,guild_id:t.guild_id,content:html},{onConflict:'ticket_id'})).catch(e=>console.error('Transcript DB:',e.message));}else console.warn(`Transcript #${t.id} maior que limite do banco; arquivo HTML será enviado aos logs.`);return result;}
async function closeTicket(i,t,s,reason='Encerrado pela equipe'){if(!i.deferred&&!i.replied)await i.deferReply({flags:ephemeral});const content=await transcript(i.channel,t,s,reason).catch(e=>{console.error('Transcript:',e.message);return null;});await query('tickets',q=>q.update({status:'closed',closed_at:stamp(),close_reason:reason}).eq('id',t.id).eq('status','open'));await event(t.id,i.guildId,i.user.id,'closed',{reason});if(s.log_channel_id){const log=await i.guild.channels.fetch(s.log_channel_id).catch(()=>null);if(log?.isTextBased()){const attachment=content?new AttachmentBuilder(Buffer.from(content.html,'utf8'),{name:`ticket-${t.id}.html`}):null;await log.send({embeds:[embed(`${icon('file')} Ticket #${t.id} encerrado`,`Cliente: <@${t.user_id}>\nResponsável: <@${i.user.id}>\nMotivo: ${reason}`,s)],...(attachment?{files:[attachment]}:{})}).catch(e=>console.error('Log:',e.message));}}if(s.dm_rating_enabled){await bot.users.fetch(t.user_id).then(u=>u.send({content:`Seu ticket #${t.id} em **${i.guild.name}** foi encerrado. Avalie o atendimento:`,components:[new ActionRowBuilder().addComponents([1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId(`rate:${t.id}:${n}`).setLabel(`${n} ${icon('like')}`).setStyle(ButtonStyle.Secondary)))]})).catch(()=>{});}await i.editReply('Ticket encerrado. O canal será removido em alguns segundos.');setTimeout(()=>i.channel.delete('Ticket encerrado').catch(()=>{}),5000);}
async function stats(g){const [tickets,ratings]=await Promise.all([query('tickets',q=>q.select('id,status,created_at').eq('guild_id',g).limit(1000)),query('ticket_ratings',q=>q.select('score').eq('guild_id',g).limit(1000))]);const avg=ratings.length?(ratings.reduce((a,b)=>a+b.score,0)/ratings.length).toFixed(2):'Sem avaliações';return `Tickets registrados (até 1000): **${tickets.length}**\nAbertos: **${tickets.filter(t=>t.status==='open').length}**\nEncerrados: **${tickets.filter(t=>t.status==='closed').length}**\nAvaliação média: **${avg}**`;}
async function gemini(text,s){if(!process.env.GEMINI_API_KEY)return null;const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),Number(process.env.AI_TIMEOUT_MS)||12000);try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL||'gemini-2.5-flash')}:generateContent`,{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:`${s.ai_prompt}\nBase de conhecimento (não invente dados):\n${safe(s.knowledge_base,8000)}\nNão peça senhas, tokens ou dados de pagamento. Se faltar informação, peça intervenção humana.`}]},contents:[{role:'user',parts:[{text:safe(text,3000)}]}],generationConfig:{maxOutputTokens:500}})});if(!r.ok)throw Error(`Gemini ${r.status}`);const data=await r.json();return safe(data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join(''),1800)||null;}finally{clearTimeout(timer);}}
const cmds=[
 new SlashCommandBuilder().setName('ticket').setDescription('Central de tickets FrioBots')
  .addSubcommand(x=>x.setName('config').setDescription('Configurações do servidor'))
  .addSubcommand(x=>x.setName('painel').setDescription('Publicar painel neste canal'))
  .addSubcommand(x=>x.setName('estatisticas').setDescription('Indicadores de atendimento'))
  .addSubcommand(x=>x.setName('ajuda').setDescription('Ajuda e comandos do sistema')),
 new SlashCommandBuilder().setName('dev').setDescription('Ferramentas globais FrioBots')
  .addSubcommand(x=>x.setName('ticket').setDescription('Central exclusiva do desenvolvedor'))
].map(x=>x.toJSON());
const startedAt=Date.now();
const helpText=()=>`**Frio Tickets • Comandos**\n**Slash:** /ticket config, /ticket painel, /ticket estatisticas, /ticket ajuda, /dev ticket\n**Prefixo (${PREFIX}):** ${['add @usuário','rem @usuário','fechar','assumir','renomear nome','prioridade alta|normal','bloquear @usuário','desbloquear @usuário'].map(x=>'`'+PREFIX+x+'`').join(' • ')}\n\nPowered by FrioMortal`;
const diagnostics=()=>`**Diagnóstico global**\n> **Bot:** ${bot.user?.tag||'desconectado'}\n> **Servidores:** ${bot.guilds.cache.size}\n> **Uptime:** ${Math.floor((Date.now()-startedAt)/60000)} minutos\n> **Ping:** ${bot.ws.ping} ms\n> **Memória:** ${Math.round(process.memoryUsage().rss/1024/1024)} MB\n> **Node.js:** ${process.version}\n> **Cache:** ${cache.size} servidores`;


bot.once('clientReady',async()=>{console.log(`${brand} online: ${bot.user.tag}`);await loadGlobalBrand().catch(e=>console.error('Marca global:',e.message));try{bot.user.setActivity(globalBrand.activity_text);}catch(e){console.error("Atividade inicial:",e.message);}if(process.env.REGISTER_COMMANDS!=='false')try{await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),{body:cmds});console.log('Comandos registrados.');}catch(e){console.error('Falha no registro de comandos:',e);}if(process.env.AUTO_SYNC_EMOJIS==='true'){for(const guild of bot.guilds.cache.values()){try{const r=await syncGuildEmojis(guild);console.log(`[Emojis] ${guild.id}: +${r.created}, existentes ${r.skipped}, falhas ${r.failed.length}`);}catch(e){console.warn(`[Emojis] ${guild.id}: ${e.message}`);}await new Promise(resolve=>setTimeout(resolve,1500));}}});
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
if(i.isChatInputCommand()){
if(i.commandName==='dev'){if(!devOnly(i))return send(i,'Acesso restrito ao desenvolvedor.');return i.reply({...devPanel(),flags:ephemeral});}
if(!i.inGuild())return send(i,'Disponível apenas em servidores.');const sub=i.options.getSubcommand();if(sub==='config'){if(!admin(i))return send(i,'Somente administradores podem configurar.');await i.deferReply({flags:ephemeral});return i.editReply(configHome(await settings(i.guildId)));}
if(sub==='painel'){if(!admin(i))return send(i,'Acesso negado.');await i.deferReply({flags:ephemeral});const msg=await publish(i.channel,i.guildId);return i.editReply(`Painel publicado: ${msg.url}`);}
if(sub==='ajuda')return i.reply({content:helpText(),flags:ephemeral});
if(sub==='estatisticas'){if(!admin(i))return send(i,'Acesso negado.');await i.deferReply({flags:ephemeral});return i.editReply({embeds:[embed(`${icon('stats')} Estatísticas`,await stats(i.guildId),await settings(i.guildId))]});}

}
if((i.isButton()||i.isModalSubmit())&&i.customId.startsWith('dev:')){
 if(!devOnly(i))return send(i,'Acesso restrito ao desenvolvedor.');
 if(i.isButton()){
  if(['dev:refresh','dev:home'].includes(i.customId))return i.update(devPanel());
  if(i.customId==='dev:diagnostics')return i.update({embeds:[embed('Diagnóstico • Frio Tickets',diagnostics())],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary))]});
  if(i.customId==='dev:servers'){const names=[...bot.guilds.cache.values()].slice(0,30).map(g=>`• ${safe(g.name,60)} (${g.id})`).join('\n');return i.update({embeds:[embed('Servidores conectados',names||'Nenhum servidor.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary))]});}
  if(i.customId==='dev:cache'){cache.clear();departmentCache.clear();return i.update({embeds:[embed('Cache limpo','As configurações serão recarregadas do Supabase quando necessárias.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev:home').setLabel('Voltar').setStyle(ButtonStyle.Secondary))]});}
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
if(i.isStringSelectMenu()&&i.customId==='cfg:main'){if(!admin(i))return send(i,'Acesso negado.');const v=i.values[0];if(!['appearance','automation'].includes(v))await i.deferUpdate();const s=cache.get(i.guildId)?.data||defaults;if(v==='publish'){/* acknowledged before database work */const msg=await publish(i.channel,i.guildId);return i.followUp({content:`Painel publicado: ${msg.url}`,flags:ephemeral});}if(v==='stats'){/* acknowledged before database work */return i.editReply({embeds:[embed(`${icon('stats')} Estatísticas`,await stats(i.guildId),s)],components:sectionNav()});}if(v==='appearance')return i.showModal(modal('cfg:save:appearance','Aparência do painel',[field('title','Título',s.panel_title),field('description','Descrição',s.panel_description,TextInputStyle.Paragraph),field('color','Cor HEX (ex: #5865F2)',s.brand_color),field('image','URL da imagem (opcional)',s.image_url||'',TextInputStyle.Short,false)]));if(v==='ai')return i.editReply({embeds:[embed(`${icon('ai')} Inteligência artificial`,`Status: **${s.ai_enabled?'Ativada':'Desativada'}**\nUse os botões para configurar a IA.`,s)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:toggle:ai_enabled').setLabel(s.ai_enabled?'Desativar IA':'Ativar IA').setEmoji(emoji(s.ai_enabled?'disable':'enable')).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('cfg:modal:ai').setLabel('Instruções e conhecimento').setEmoji(emoji('edit')).setStyle(ButtonStyle.Secondary)),...sectionNav()]});if(v==='automation')return i.showModal(modal('cfg:save:automation','Automações',[field('limit','Limite de tickets por usuário',String(s.max_open_tickets)),field('hours','Inatividade em horas (0 desativa)',String(s.inactivity_hours)),field('transcript','Transcrições (sim/não)',s.transcript_enabled?'sim':'não'),field('rating','Avaliação por DM (sim/não)',s.dm_rating_enabled?'sim':'não')]));if(v==='routing')return i.editReply({embeds:[embed(`${icon('routing')} Canais e equipe`,'Escolha uma categoria, um canal de logs ou o cargo da equipe.',s)],components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg:channel:category_id').setPlaceholder('Categoria dos tickets').setChannelTypes(ChannelType.GuildCategory)),new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg:channel:log_channel_id').setPlaceholder('Canal de logs').setChannelTypes(ChannelType.GuildText)),new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg:role:staff_role_id').setPlaceholder('Cargo da equipe')),...sectionNav()]});if(v==='departments'){/* acknowledged before database work */const ds=await departments(i.guildId);return i.editReply({embeds:[embed(`${icon('departments')} Departamentos`,ds.length?ds.map(d=>`**#${d.id} • ${d.name}** — ${safe(d.description,70)}`).join('\n').slice(0,3500):'Nenhum departamento cadastrado.',s)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg:modal:department').setLabel('Criar departamento').setEmoji(emoji('add')).setStyle(ButtonStyle.Success)),...(ds.length?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cfg:department:delete').setPlaceholder('Desativar departamento').addOptions(ds.slice(0,25).map(d=>({label:safe(d.name,100),value:String(d.id),emoji:emoji('delete')}))))]:[]),...sectionNav()]});}
if(i.isChannelSelectMenu()&&i.customId.startsWith('cfg:channel:')){if(!admin(i))return send(i,'Acesso negado.');const key=i.customId.split(':')[2];if(!['category_id','log_channel_id'].includes(key))return send(i,'Campo inválido.');await i.deferUpdate();await save(i.guildId,{[key]:i.values[0]});return i.editReply({embeds:[embed('Configuração atualizada', 'Canal salvo.',await settings(i.guildId))],components:sectionNav()});}
if(i.isRoleSelectMenu()&&i.customId==='cfg:role:staff_role_id'){if(!admin(i))return send(i,'Acesso negado.');await i.deferUpdate();await save(i.guildId,{staff_role_id:i.values[0]});return i.editReply({embeds:[embed('Configuração atualizada', 'Cargo salvo.',await settings(i.guildId))],components:sectionNav()});}
if(i.isStringSelectMenu()&&i.customId==='cfg:department:delete'){if(!admin(i))return send(i,'Acesso negado.');await i.deferUpdate();await query('ticket_departments',q=>q.update({enabled:false}).eq('guild_id',i.guildId).eq('id',Number(i.values[0])));departmentCache.delete(i.guildId);return i.editReply({embeds:[embed('Configuração atualizada', 'Departamento desativado. Publique um novo painel para atualizar as opções.',await settings(i.guildId))],components:sectionNav()});}
if(i.isButton()&&i.customId.startsWith('cfg:toggle:')){if(!admin(i))return send(i,'Acesso negado.');await i.deferUpdate();const s=await settings(i.guildId);await save(i.guildId,{ai_enabled:!s.ai_enabled});return i.editReply({embeds:[embed('Inteligência artificial',`IA ${!s.ai_enabled?'ativada':'desativada'}.`,await settings(i.guildId))],components:sectionNav()});}
if(i.isButton()&&i.customId==='cfg:modal:ai'){if(!admin(i))return send(i,'Acesso negado.');const s=cache.get(i.guildId)?.data||defaults;return i.showModal(modal('cfg:save:ai','Configuração da IA',[field('prompt','Personalidade e instruções',s.ai_prompt,TextInputStyle.Paragraph),field('knowledge','Base de conhecimento',s.knowledge_base,TextInputStyle.Paragraph,false)]));}
if(i.isButton()&&i.customId==='cfg:modal:department'){if(!admin(i))return send(i,'Acesso negado.');return i.showModal(modal('cfg:save:department','Novo departamento',[field('name','Nome do departamento'),field('description','Descrição curta','',TextInputStyle.Short,false),field('question','Pergunta do formulário','Descreva sua solicitação'),field('category','ID da categoria (opcional)','',TextInputStyle.Short,false),field('role','ID do cargo da equipe (opcional)','',TextInputStyle.Short,false)]));}
if(i.isModalSubmit()&&i.customId.startsWith('cfg:save:')){if(!admin(i))return send(i,'Acesso negado.');await i.deferReply({flags:ephemeral});const type=i.customId.split(':')[2],get=k=>i.fields.getTextInputValue(k).trim();if(type==='appearance'){const hex=get('color');if(!/^#[0-9a-f]{6}$/i.test(hex))return send(i,'Cor inválida. Use #RRGGBB.');if(get('image')&&!/^https:\/\//i.test(get('image')))return send(i,'Imagem precisa usar HTTPS.');await save(i.guildId,{panel_title:safe(get('title'),200),panel_description:safe(get('description'),2000),brand_color:hex,image_url:get('image')||null});return send(i,'Aparência salva. Publique um novo painel para aplicar.');}if(type==='ai'){await save(i.guildId,{ai_prompt:get('prompt'),knowledge_base:get('knowledge')});return send(i,'Configuração da IA salva.');}if(type==='automation'){const limit=Number(get('limit')),hours=Number(get('hours'));if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(hours)||hours<0||hours>720)return send(i,'Valores inválidos: limite 1–20 e horas 0–720.');const yes=v=>['sim','s','true'].includes(v.toLowerCase());await save(i.guildId,{max_open_tickets:limit,inactivity_hours:hours,transcript_enabled:yes(get('transcript')),dm_rating_enabled:yes(get('rating'))});return send(i,'Automações e limites salvos.');}if(type==='department'){const category=get('category'),role=get('role');if(category&&!i.guild.channels.cache.has(category))return send(i,'Categoria não encontrada.');if(role&&!i.guild.roles.cache.has(role))return send(i,'Cargo não encontrado.');const ds=await departments(i.guildId);if(ds.length>=25)return send(i,'Limite de 25 departamentos por painel.');await query('ticket_departments',q=>q.insert({guild_id:i.guildId,name:safe(get('name'),100),description:safe(get('description'),100),form_question:safe(get('question'),100),category_id:category||null,staff_role_id:role||null,sort_order:ds.length}));departmentCache.delete(i.guildId);return send(i,'Departamento criado. Publique um painel para disponibilizá-lo.');}}
if(i.isStringSelectMenu()&&i.customId==='ticket:department'){if(!i.inGuild())return send(i,'Apenas em servidores.');const departmentId=Number(i.values[0]);if(!Number.isSafeInteger(departmentId))return send(i,'Departamento inválido.');return i.showModal(modal(`ticket:form:${departmentId}`,'Abrir ticket',[field('answer','Descreva sua solicitação','',TextInputStyle.Paragraph)]));}
if(i.isModalSubmit()&&i.customId.startsWith('ticket:form:')){await i.deferReply({flags:ephemeral});const d=await query('ticket_departments',q=>q.select('*').eq('id',Number(i.customId.split(':')[2])).eq('guild_id',i.guildId).eq('enabled',true).maybeSingle());if(!d)return send(i,'Departamento não encontrado.');return openTicket(i,d,i.fields.getTextInputValue('answer'));}
if(i.isButton()&&i.customId.startsWith('rate:')){await i.deferUpdate();const [,id,score]=i.customId.split(':');const t=await query('tickets',q=>q.select('id,user_id,guild_id').eq('id',Number(id)).maybeSingle());if(!t||t.user_id!==i.user.id)return send(i,'Avaliação não autorizada.');await query('ticket_ratings',q=>q.upsert({ticket_id:t.id,guild_id:t.guild_id,user_id:i.user.id,score:Number(score)},{onConflict:'ticket_id'}));return i.editReply({content:`Obrigado pela avaliação: ${score}/5!`,components:[]});}
if(i.isButton()&&i.customId.startsWith('ticket:')){if(!i.inGuild())return send(i,'Apenas em servidores.');if(i.customId==='ticket:close')return i.showModal(modal('ticket:close:channel','Encerrar atendimento',[field('reason','Motivo do encerramento','Atendimento concluído',TextInputStyle.Paragraph)]));await i.deferReply({flags:ephemeral});const t=await query('tickets',q=>q.select('*').eq('channel_id',i.channelId).eq('status','open').maybeSingle());if(!t)return send(i,'Ticket não encontrado ou encerrado.');const s=await settings(i.guildId),d=t.department_id?await query('ticket_departments',q=>q.select('*').eq('id',t.department_id).maybeSingle()):null,staff=await isStaff(i,s,d);if(i.customId==='ticket:claim'){if(!staff)return send(i,'Apenas a equipe pode assumir.');await query('tickets',q=>q.update({claimed_by:i.user.id}).eq('id',t.id));await event(t.id,i.guildId,i.user.id,'claimed');return i.reply({content:`Atendimento assumido por <@${i.user.id}>.`});}if(i.customId==='ticket:priority'){if(!staff)return send(i,'Apenas a equipe pode definir prioridade.');const priority=t.priority==='normal'?'alta':'normal';await query('tickets',q=>q.update({priority}).eq('id',t.id));await event(t.id,i.guildId,i.user.id,'priority',{priority});return send(i,`Prioridade alterada para **${priority}**.`);}if(i.customId==='ticket:close'){if(!staff&&t.user_id!==i.user.id)return send(i,'Você não pode encerrar este ticket.');return i.showModal(modal(`ticket:close:${t.id}`,'Encerrar atendimento',[field('reason','Motivo do encerramento','Atendimento concluído',TextInputStyle.Paragraph)]));}}
if(i.isModalSubmit()&&i.customId.startsWith('ticket:close:')){await i.deferReply({flags:ephemeral});const t=await query('tickets',q=>q.select('*').eq('channel_id',i.channelId).eq('status','open').maybeSingle());if(!t)return send(i,'Ticket já encerrado.');const s=await settings(i.guildId),d=t.department_id?await query('ticket_departments',q=>q.select('*').eq('id',t.department_id).maybeSingle()):null;if(!await isStaff(i,s,d)&&t.user_id!==i.user.id)return send(i,'Acesso negado.');return closeTicket(i,t,s,i.fields.getTextInputValue('reason'));}
if(i.isMessageComponent()||i.isModalSubmit())return send(i,'Esta ação não está disponível nesta versão. Atualize o painel e tente novamente.');
}}catch(e){console.error('Erro na interação:',e);const msg=`Não foi possível concluir a ação: ${safe(e.message,140)}`;if(i.deferred&&!i.replied)await i.editReply({content:msg,embeds:[],components:[]}).catch(()=>{});else if(i.replied)await i.followUp({content:msg,flags:ephemeral}).catch(()=>{});else await i.reply({content:msg,flags:ephemeral}).catch(()=>{});}});
// Comandos de prefixo: atalhos administrativos; menus continuam em interações.
const PREFIX=process.env.BOT_PREFIX||'.';
const PREFIX_COMMANDS=new Set(['add','adicionar','rem','remover','fechar','assumir','renomear','prioridade','bloquear','desbloquear']);
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
 if(['fechar','assumir','renomear','prioridade'].includes(cmd)){
  if(!t){await reply('Este comando só funciona em um ticket aberto.');return true;}
  if(!staff && !(cmd==='fechar'&&t.user_id===m.author.id)){await reply('Ação restrita à equipe de atendimento.');return true;}
  if(cmd==='assumir'){await query('tickets',q=>q.update({claimed_by:m.author.id}).eq('id',t.id));await event(t.id,m.guild.id,m.author.id,'claimed');await reply(`Atendimento assumido por <@${m.author.id}>.`);}
  if(cmd==='prioridade'){const value=(parts[0]||'').toLowerCase();if(!['alta','normal'].includes(value)){await reply('Use `.prioridade alta` ou `.prioridade normal`.');return true;}await query('tickets',q=>q.update({priority:value}).eq('id',t.id));await event(t.id,m.guild.id,m.author.id,'priority',{priority:value});await reply(`Prioridade: **${value}**.`);}
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

bot.on('messageCreate',async m=>{if(!m.guild||m.author.bot)return;try{if(await handlePrefix(m))return;const t=await query('tickets',q=>q.select('id,department_id').eq('channel_id',m.channel.id).eq('status','open').maybeSingle());if(!t)return;await query('tickets',q=>q.update({last_activity_at:stamp()}).eq('id',t.id));const s=await settings(m.guild.id);if(!s.ai_enabled||!process.env.GEMINI_API_KEY||!m.content.trim())return;const d=t.department_id?await query('ticket_departments',q=>q.select('ai_enabled').eq('id',t.department_id).maybeSingle()):null;if(d&&!d.ai_enabled)return;const key=m.channel.id;if(Date.now()-(aiCooldown.get(key)||0)<30000)return;aiCooldown.set(key,Date.now());await m.channel.sendTyping();const reply=await gemini(m.content,s);if(reply)await m.reply({content:`**Assistente IA**\n${reply}`,allowedMentions:{parse:[],repliedUser:false}});}catch(e){console.error('IA/mensagem:',e.message);}});
// Verificação leve de inatividade, sem varreduras pesadas ou deleções automáticas.
setInterval(async()=>{try{for(const g of bot.guilds.cache.values()){const s=await settings(g.id);if(!s.inactivity_hours)continue;const limit=new Date(Date.now()-s.inactivity_hours*3600000).toISOString();const old=await query('tickets',q=>q.select('id,channel_id').eq('guild_id',g.id).eq('status','open').lt('last_activity_at',limit).limit(10));for(const t of old){const key=`reminder:${t.id}`;if(Date.now()-(aiCooldown.get(key)||0)<3600000)continue;aiCooldown.set(key,Date.now());const ch=await g.channels.fetch(t.channel_id).catch(()=>null);if(ch?.isTextBased())await ch.send({content:'Este atendimento está inativo. Caso ainda precise de ajuda, envie uma mensagem para continuar.',allowedMentions:{parse:[]}}).catch(()=>{});}}}catch(e){console.error('Inatividade:',e.message);}},15*60*1000).unref();
process.on('unhandledRejection',e=>console.error('Unhandled:',e));process.on('SIGTERM',()=>bot.destroy());bot.login(process.env.DISCORD_TOKEN);
