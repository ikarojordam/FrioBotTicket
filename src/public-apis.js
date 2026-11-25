// Consultas factuais a fontes públicas, SEM chaves e SEM enviar o histórico do ticket.
// O roteador só transmite parâmetros estritamente necessários à fonte selecionada.
// Não é um modelo generativo nem faz análise visual.
const MAX_CACHE = 90;
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();
const inflight = new Map();
const cooldown = new Map();
const MAX_OUTPUT = 1450;
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clean = s => String(s ?? '').replace(/[`<>@\r\n\t]/g, ' ').replace(/\s+/g,' ').trim().slice(0,240);
const esc = encodeURIComponent;
const MONEY = n => Number.isFinite(Number(n)) ? Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2}) : 'indisponível';
const endpoints = Object.freeze({
  viacep: 'https://viacep.com.br', brasilapi: 'https://brasilapi.com.br', ibge: 'https://servicodados.ibge.gov.br',
  wikipedia: 'https://pt.wikipedia.org', npm: 'https://registry.npmjs.org', pypi: 'https://pypi.org',
  github: 'https://api.github.com', openlibrary: 'https://openlibrary.org',
  weathergeo: 'https://geocoding-api.open-meteo.com', weather: 'https://api.open-meteo.com',
  frankfurter: 'https://api.frankfurter.dev',
});
// Roteamento por intenção: não faça buscas abertas usando texto do ticket.
function route(input){
 const raw=String(input||'').trim().slice(0,600), n=normalize(raw);
 // Ignora conteúdos pessoais potencialmente sensíveis e instruções de contas privadas.
 if(/(?:senha|password|token|senha de acesso|codigo de verificacao|autenticacao|2fa|cartao|cpf|rg|pix|comprovante|pedido #|email|e-mail|@everyone|discord\.gg|https?:\/\/)/i.test(n)) return null;
 let m;
 if(/\b(?:cep|codigo postal|endereco pelo cep|logradouro)\b/.test(n) && (m=n.match(/\b(\d{5})[- ]?(\d{3})\b/)))return {kind:'cep',key:m[1]+m[2]};
 if(/\b(?:ddd|codigo de area|telefone regional)\b/.test(n) && (m=n.match(/\b(?:ddd|codigo de area)\D{0,12}(\d{2})\b/)))return {kind:'ddd',key:m[1]};
 if(/\b(?:feriados?|datas comemorativas)\b/.test(n) && (m=n.match(/\b20\d{2}\b/)))return {kind:'holidays',key:m[0]};
 if(/\b(?:banco|instituicao financeira|codigo bancario)\b/.test(n) && (m=n.match(/\b(?:banco|codigo bancario)\D{0,10}(\d{1,4})\b/)))return {kind:'bank',key:m[1]};
 if(/\b(?:municipios?|cidades?)\b/.test(n) && (m=n.match(/\b(?:estado|uf|de|do|da|em)\s+(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i)))return {kind:'cities',key:m[1].toUpperCase()};
 if(/\b(?:cotacao|converter|cambio)\b/.test(n) && (m=n.match(/\b(usd|eur|brl|gbp|jpy|cad|aud)\s+(?:para|em|to)\s+(usd|eur|brl|gbp|jpy|cad|aud)\b/)))return {kind:'fx',key:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`};
 if(/\b(?:npm|pacote npm|biblioteca javascript)\b/.test(n) && (m=raw.match(/\b(?:npm|pacote npm|biblioteca javascript)\s+(?:do |de |sobre |chamado |pacote )?(@?[\w.-]+(?:\/[\w.-]+)?)/i)))return {kind:'npm',key:m[1]};
 if(/\b(?:pypi|pacote python|biblioteca python)\b/.test(n) && (m=raw.match(/\b(?:pypi|pacote python|biblioteca python)\s+(?:do |de |sobre |chamado )?([\w.-]+)/i)))return {kind:'pypi',key:m[1]};
 if(/\b(?:github|repositorio|repositório)\b/.test(n) && (m=raw.match(/\b([\w.-]{1,39})\/([\w.-]{1,100})\b/)))return {kind:'github',key:`${m[1]}/${m[2]}`};
 if(/\b(?:livro|autor do livro|publicacao do livro)\b/.test(n) && (m=raw.match(/(?:livro|autor do livro|publica[çc][aã]o do livro)\s+(?:de |sobre |chamado |["“])?([^?.!"”]{3,70})/i)))return {kind:'book',key:clean(m[1])};
 // Clima exige revisão dos termos para uso comercial. Desligado por padrão.
 if(process.env.PUBLIC_API_WEATHER_ENABLED==='true' && /\b(?:clima|previsao do tempo|temperatura)\b/.test(n) && (m=raw.match(/(?:em|para)\s+([\p{L}][\p{L} .'-]{2,55})/iu)))return {kind:'weather',key:clean(m[1])};
 if(/^(?:o que (?:e|eh)|quem (?:foi|e|eh)|explique|defina|significado de)\s+/i.test(n)){
  const term=clean(raw.replace(/^(?:o que [ée]|quem (?:foi|[ée])|explique|defina|significado de)\s+/i,'').replace(/[?.!]$/,''));
  // Só envia termos públicos curtos, nunca uma história de atendimento.
  if(term.length>=3&&term.length<=55&&term.split(' ').length<=6&&!/[\d@]/.test(term))return {kind:'wiki',key:term};
 }
 return null;
}
async function getJson(origin,path,params){
 const base=endpoints[origin];if(!base)throw Error('Fonte não aprovada');
 const url=new URL(path,base);
 if(url.origin!==base)throw Error('URL externa bloqueada');
 for(const [k,v] of Object.entries(params||{}))url.searchParams.set(k,String(v));
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),3800);
 try{
  const r=await fetch(url,{signal:controller.signal,redirect:'error',headers:{'Accept':'application/json','User-Agent':'FrioTickets-Suporte/1.0 (public-info; no-auth)'}});
  if(!r.ok)throw Error(`Fonte temporariamente indisponível (HTTP ${r.status})`);
  const contentType=r.headers.get('content-type')||'';if(!contentType.includes('json'))throw Error('Resposta inesperada');
  const size=Number(r.headers.get('content-length')||0);if(size>240000)throw Error('Resposta muito grande');
  const body=await r.text();if(body.length>240000)throw Error('Resposta muito grande');
  return JSON.parse(body);
 }finally{clearTimeout(timer);}
}
const result=(source,body)=>({source,answer:clean(body).slice(0,MAX_OUTPUT)});
async function resolve(req){
 const v=req.key;
 switch(req.kind){
  case 'cep': {const a=await getJson('viacep',`/ws/${v}/json/`);if(a.erro)return null;return result('ViaCEP',`CEP ${v}: ${a.logradouro||'logradouro não informado'}, ${a.bairro||'bairro não informado'}, ${a.localidade||'município não informado'} - ${a.uf||'UF não informada'}.`);}
  case 'ddd': {const a=await getJson('brasilapi',`/api/ddd/v1/${v}`);return result('BrasilAPI',`DDD ${v}: ${a.state||'estado não identificado'}. Cidades relacionadas: ${(a.cities||[]).slice(0,9).join(', ')}${(a.cities||[]).length>9?' e outras':''}.`);}
  case 'holidays': {const a=await getJson('brasilapi',`/api/feriados/v1/${v}`);return result('BrasilAPI',`Feriados nacionais de ${v}: ${a.slice(0,15).map(x=>`${x.date} ${clean(x.name)}`).join('; ')}.`);}
  case 'bank': {const a=await getJson('brasilapi',`/api/banks/v1/${v}`);return result('BrasilAPI',`Código bancário ${v}: ${a.fullName||a.name||'não encontrado'}.`);}
  case 'cities': {const a=await getJson('ibge',`/api/v1/localidades/estados/${v}/municipios`);return result('IBGE',`O estado ${v} tem ${a.length} municípios listados pelo IBGE. Exemplos: ${a.slice(0,12).map(x=>clean(x.nome)).join(', ')}.`);}
  case 'fx': {const [from,to]=v.split(':');if(from===to)return result('Frankfurter',`As duas moedas são ${from}; 1 ${from} equivale a 1 ${to}.`);const a=await getJson('frankfurter','/v1/latest',{base:from,symbols:to});return result('Frankfurter',`Cotação de referência em ${a.date}: 1 ${from} = ${MONEY(a.rates?.[to])} ${to}. Não inclui taxas de operação.`);}
  case 'npm': {const a=await getJson('npm',`/${esc(v)}/latest`);return result('Registro npm',`Pacote ${v}, versão ${a.version||'não informada'}. ${clean(a.description||'Sem descrição')}`);}
  case 'pypi': {const a=await getJson('pypi',`/pypi/${esc(v)}/json`);return result('PyPI',`Biblioteca ${v}, versão ${a.info?.version||'não informada'}. ${clean(a.info?.summary||'Sem descrição')}`);}
  case 'github': {const a=await getJson('github',`/repos/${v}`);return result('GitHub',`Repositório ${v}: ${clean(a.description||'Sem descrição')}. Linguagem principal: ${a.language||'não indicada'}. Última atualização: ${String(a.updated_at||'').slice(0,10)||'não informada'}.`);}
  case 'book': {const a=await getJson('openlibrary','/search.json',{title:v,limit:1,fields:'title,author_name,first_publish_year'});const b=a.docs?.[0];return b?result('Open Library',`Livro: ${b.title}. Autor(es): ${(b.author_name||[]).slice(0,3).join(', ')||'não informado'}. Primeira publicação: ${b.first_publish_year||'não informada'}.`):null;}
  case 'weather': {const g=await getJson('weathergeo','/v1/search',{name:v,count:1,language:'pt'});const p=g.results?.[0];if(!p)return null;const w=await getJson('weather','/v1/forecast',{latitude:p.latitude,longitude:p.longitude,current:'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',timezone:'auto'});const x=w.current||{};return result('Open-Meteo',`Tempo em ${p.name} (${p.country_code}): ${x.temperature_2m} °C, umidade ${x.relative_humidity_2m}%, precipitação ${x.precipitation} mm e vento ${x.wind_speed_10m} km/h. Dados: ${x.time||'atualização não informada'}.`);}
  case 'wiki': {const a=await getJson('wikipedia',`/api/rest_v1/page/summary/${esc(v)}`);if(!a.extract||a.type==='disambiguation')return null;return result('Wikipédia',a.extract.slice(0,800));}
  default:return null;
 }
}
export function expirePublicApiCache(){const now=Date.now();for(const [k,v] of cache){if(now-v.time>CACHE_TTL)cache.delete(k);}for(const [k,v] of cooldown){if(now-v>60000)cooldown.delete(k);}while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);}
export function identifyPublicQuery(text){return route(text);}
export async function publicApiAnswer(guild,person,text){
 if(process.env.PUBLIC_APIS_ENABLED==='false')return null;
 const req=route(text);if(!req)return null;
 const id=`${guild}:${person}`;const now=Date.now();if(now-(cooldown.get(id)||0)<12000)return null;
 const key=`${req.kind}:${req.key.toLowerCase()}`;const previous=cache.get(key);
 if(previous&&now-previous.time<CACHE_TTL)return previous.value;
 if(inflight.has(key))return inflight.get(key);
 cooldown.set(id,now);
 const task=resolve(req).catch(e=>{if(process.env.PUBLIC_APIS_LOG==='true')console.warn(`[APIs públicas] ${req.kind}: ${e.message}`);return null;}).then(value=>{if(value){if(cache.size>=MAX_CACHE)cache.delete(cache.keys().next().value);cache.set(key,{value,time:Date.now()});}return value;}).finally(()=>inflight.delete(key));
 inflight.set(key,task);return task;
}
