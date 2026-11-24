// Busca local conservadora sobre candidatos já selecionados pelo Supabase.
// Sem rede neural: não gera respostas inéditas nem garante compreensão de toda pergunta.
export const normalizeFAQ = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const stop=new Set(['a','o','os','as','um','uma','de','da','do','das','dos','em','no','na','nos','nas','eu','me','meu','minha','por','para','com','e','que','qual','quais','como','onde','quando','tem','ter','voce','voces','oi','ola','bom','dia','boa','tarde']);
const tokens=s=>new Set(normalizeFAQ(s).split(' ').filter(w=>w.length>2&&!stop.has(w)));
const negation=s=>/\b(nao|nunca|sem|impossivel)\b/.test(s);
export function localAnswer(text,entries=[]){
 const q=normalizeFAQ(text);if(!q||q.length>500)return null;
 const qt=tokens(q);let best=null,bestScore=-1;
 for(const entry of entries){
  const k=entry.normalized_question||normalizeFAQ(entry.question);if(!k||!entry.answer)continue;
  const exact=q===k;
  const whole=k.length>=5&&(` ${q} `).includes(` ${k} `);
  const kt=tokens(k),matched=[...kt].filter(t=>qt.has(t)).length;
  const precision=kt.size?matched/kt.size:0,recall=qt.size?matched/qt.size:0;
  const intersection=matched>0?2*precision*recall/(precision+recall):0;
  let score=exact?1:whole&&kt.size>0?Math.min(.96,.78+.18*recall):intersection;
  // Perguntas com negação oposta podem significar o contrário.
  if(!exact && negation(q)!==negation(k))score*=.42;
  // Respostas aprendidas da equipe têm prioridade somente quando a pergunta encaixa.
  if(entry.guild_id && score>=.72)score+=.015;
  // Evita responder questões compridas com uma expressão genérica vaga.
  if(!exact&&qt.size>=5&&kt.size<=1)score=Math.min(score,.55);
  if(score>bestScore){bestScore=score;best=entry;}
 }
 return best&&bestScore>=.76?{answer:best.answer,confidence:Math.min(1,Math.round(bestScore*100)/100),source:best.source}:null;
}
