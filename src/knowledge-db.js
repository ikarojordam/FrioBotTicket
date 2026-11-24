import { normalizeFAQ,localAnswer } from './local-ai.js';
// Cada resposta consulta o índice do Supabase: não carrega todas as perguntas na RAM.
// Sem limite artificial de registros; há somente 30 candidatos por consulta.
const cache=new Map();
export function clearKnowledge(guild){if(guild){for(const k of cache.keys())if(k.startsWith(`${guild}:`))cache.delete(k);}else cache.clear();}
export function expireKnowledge(){const now=Date.now();for(const [k,v] of cache)if(now-v.time>15000)cache.delete(k);while(cache.size>80)cache.delete(cache.keys().next().value);}
export function createKnowledge(db){
 async function answer(guild,text){
  const normalized=normalizeFAQ(text);if(normalized.length<2||normalized.length>500)return null;
  const key=`${guild}:${normalized}`,recent=cache.get(key);
  if(recent&&Date.now()-recent.time<15000)return recent.answer;
  const {data,error}=await db.rpc('ticket_ai_search',{p_guild:String(guild),p_question:normalized,p_limit:30});
  if(error)throw new Error(`Falha na busca de conhecimento. Execute sql/013_ai_search_scalable.sql: ${error.message}`);
  const result=localAnswer(text,data||[]);
  if(cache.size>=80)cache.delete(cache.keys().next().value);
  cache.set(key,{answer:result,time:Date.now()});return result;
 }
 async function count(guild){const {count,error}=await db.from('ticket_ai_knowledge').select('id',{head:true,count:'exact'}).or(`guild_id.is.null,guild_id.eq.${guild}`);if(error)throw error;return count||0;}
 async function teach(guild,question,response,by,source='staff'){
  const q=String(question||'').trim(),a=String(response||'').trim(),normalized=normalizeFAQ(q);
  // Os limites abaixo são de TAMANHO da mensagem (Discord/SQL), não de quantidade aprendida.
  if(normalized.length<5||normalized.length>350||a.length<8||a.length>1600)return false;
  const unsafe=/https?:\/\/|discord\.gg|<@|@everyone|@here|\b(?:senha|password|token|cpf|pix|chave|email|e-mail|telefone|endereco|endereço|codigo de verificacao)\b|\b\d{7,}\b/i;
  if(unsafe.test(q)||unsafe.test(a))return false;
  const {error}=await db.from('ticket_ai_knowledge').upsert({guild_id:guild,question:q,normalized_question:normalized,answer:a,source,created_by:by,updated_at:new Date().toISOString()},{onConflict:'guild_id,normalized_question'});
  if(error)throw error;
  clearKnowledge(guild);return true;
 }
 async function markUnanswered(guild,question){const normalized=normalizeFAQ(question);if(normalized.length<5||normalized.length>350||/https?:\/\/|<@|\b(?:senha|password|token|cpf|email|e-mail|telefone|codigo de verificacao)\b|\b\d{7,}\b/i.test(question))return;const {error}=await db.rpc('ticket_ai_mark_unanswered',{p_guild:guild,p_question:question.slice(0,500),p_normalized:normalized});if(error)throw error;}
 return {answer,count,teach,markUnanswered};
}
