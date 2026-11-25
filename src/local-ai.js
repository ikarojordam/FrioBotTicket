// Classificador local de intenção e reclassificação dos candidatos do Supabase.
// Não é um LLM: quando não houver evidência suficiente, encaminha à equipe.
export const normalizeFAQ = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const stop=new Set('a o os as um uma de da do das dos em no na nos nas eu me meu minha por para com e que qual quais como onde quando tem ter voce voces oi ola bom dia boa tarde poderia preciso queria gostaria saber ajuda ajudar sobre isso esse essa aquele aquela ai la aqui'.split(' '));
const tokens=s=>new Set(normalizeFAQ(s).split(' ').filter(w=>w.length>2&&!stop.has(w)));
const topics={
 tickets: ['ticket','tickets','atendimento','atendimentos','transcript','transcripts','abrir chamado','fechar chamado'],
 logs: ['log','logs','registro','registros','auditoria'],
 voice: ['call','voz','voice','audio','microfone','canal de voz'],
 queue: ['fila','filas','mediador','aposta','apostas'],
 store: ['loja','pedido','pedidos','produto','produtos','compra','compras','entrega','entregas','garantia','reembolso'],
 payment: ['pix','pagamento','pagamentos','deposito','saque','mercado pago'],
 hosting: ['hospedagem','hospedar','discloud','render','deploy','ram','servidor online'],
 database: ['supabase','postgres','sql','banco de dados','tabela'],
 security: ['permissao','permissoes','cargo','cargos','bloquear','lockall','unlockall','banir','expulsar'],
 code: ['codigo','programar','javascript','node','discord js','python','erro','bug','crash'],
 bot: ['bot','bots','aplicacao','aplicacoes','frio applications']
};
const normalizePhrases=Object.fromEntries(Object.entries(topics).map(([k,v])=>[k,v.map(normalizeFAQ)]));
function detectedTopics(s){const n=` ${normalizeFAQ(s)} `;const found=new Set();for(const [topic,phrases] of Object.entries(normalizePhrases))for(const p of phrases)if(n.includes(` ${p} `)){found.add(topic);break;}return found;}
function hasNegation(s){return /\b(nao|nunca|sem|impossivel)\b/.test(normalizeFAQ(s));}
function isVague(q){const ts=tokens(q);return ts.size<=2||/^(e |mas |entao |sobre |isso |esse |essa |como faz |como resolvo)/.test(q);}
export function localAnswer(text,entries=[],options={}){
 const question=normalizeFAQ(text);if(!question||question.length>500)return null;
 const context=normalizeFAQ(options.context||'').slice(0,400);
 const contextual=isVague(question)&&context?`${context} ${question}`:question;
 const qt=tokens(contextual),queryTopics=detectedTopics(contextual);
 const guild=options.guildId?String(options.guildId):null;
 const scored=[];
 for(const entry of entries){
  const key=normalizeFAQ(entry.normalized_question||entry.question);
  if(!key||!entry.answer||entry.guild_id&&guild&&entry.guild_id!==guild)continue;
  const kt=tokens(key),matched=[...kt].filter(t=>qt.has(t)).length;
  const exact=question===key;
  const precision=kt.size?matched/kt.size:0;
  const recall=qt.size?matched/qt.size:0;
  const f1=matched?2*precision*recall/(precision+recall):0;
  let score=exact?1:f1;
  // Evita match de "configurar bot" para dúvidas específicas sobre voz ou logs.
  if(!exact&&kt.size<=2&&qt.size>kt.size+1)score=Math.min(score,0.68);
  if(!exact&&hasNegation(question)!==hasNegation(key))score*=0.40;
  const answerTopics=detectedTopics(`${key} ${entry.answer}`);
  const keyTopics=detectedTopics(key);
  // O rótulo do assunto da pergunta pesa mais que palavras presentes na resposta.
  const specific=[...queryTopics].filter(t=>t!=='bot');
  if(specific.length){
   if(specific.some(t=>keyTopics.has(t)))score+=0.09;
   else if(specific.some(t=>answerTopics.has(t)))score+=0.015;
   else score-=0.21;
  }
  // Dá prioridade ao conteúdo próprio do servidor, desde que já seja pertinente.
  if(guild&&entry.guild_id===guild&&score>=0.58)score+=0.045;
  if(entry.source==='staff'&&score>=0.70)score+=0.02;
  scored.push({entry,score,matched,exact,key});
 }
 scored.sort((a,b)=>b.score-a.score||(b.matched-a.matched));
 const best=scored[0],second=scored[1];
 if(!best||best.score<0.77)return null;
 // Desempate: uma resposta global não suplanta resposta específica do servidor com qualidade parecida.
 if(second&&second.entry.answer!==best.entry.answer&&best.score-second.score<0.035&&!best.exact){
  // Intenções demasiado próximas exigem esclarecimento.
  return null;
 }
 return {answer:best.entry.answer,confidence:Math.min(1,Math.round(best.score*100)/100),source:best.entry.source,matchedQuestion:best.entry.question};
}
