/* Frio Tickets — catálogo central de emojis • FrioBots / FrioStore */
export const EMOJIS = {
  "config": "<:config:1516629681951080489>",
  "appearance": "<:lapis:1544379513763401839>",
  "routing": "<:escudo_branco:1556704711296688168>",
  "ai": "<:rocket:1557586277627469855>",
  "automation": "<:clockcheck:1557699446652010538>",
  "departments": "<:lista:1556702800610725978>",
  "publish": "<:web:1557586294677184634>",
  "stats": "<:trofeus_1:1556704773552742430>",
  "support": "<:suporteaocliente:1557699381996691506>",
  "claim": "<:check:1557452934655123486>",
  "priority": "<:circle_alert:1557452852509802546>",
  "close": "<:lixo:1544379771176230992>",
  "add": "<:plus:1557587119155970078>",
  "remove": "<:lixo:1544379771176230992>",
  "enable": "<:on:1557586266814681122>",
  "disable": "<:off:1557586271323291700>",
  "edit": "<:lapis:1544379513763401839>",
  "delete": "<:lixo:1544379771176230992>",
  "file": "<:arquivo:1544379265330581545>",
  "verify": "<a:verificado:1556704709602054154>",
  "help": "<:circle_help:1557452846281007274>",
  "back": "<:seta_ghost:1556717902286291074>",
  "pix": "<:pix:1557699467728265256>",
  "gift": "<:gift:1557587116031213568>",
  "money": "<:whitemoney:1556704780347252839>",
  "arrow": "<:setinha:1556704769677197507>",
  "delivery": "<:entrega:1556704727062814730>",
  "member": "<:membro:1547869605589028874>",
  "event": "<a:evento:1554185023236608000>",
  "cart": "<:Carrinho_WJ:1557699389839900672>",
  "boost": "<a:Foguete:1557699477022707812>",
  "question": "<:Duvida_Space:1557588090074304582>",
  "verified_anim": "<a:verified:1557699436010934343>",
  "website": "<:website:1557587109689294858>",
  "loading": "<a:carregando:1515107214409334904>",
  "loading_alt": "<a:loading:1519193593040867379>",
  "reloading": "<a:reloading:1516626808504586313>",
  "settings": "<a:settings:1534593466368262283>",
  "verified": "<:verified:1526764926151168153>",
  "wallet": "<:wallet:1557452894549180457>",
  "copy": "<:copiar:1544045535940444300>",
  "control": "<:controle2:1519177872022048778>",
  "misc": "<:1317224138594586665:1534594455942991982>",
  "phone": "<:Celular:1534593662695243937>",
  "computer": "<:computer:1534593598883102870>",
  "expired": "<:expireuser:1534594558846042262>",
  "infinity": "<:infinity:1557452927277338706>",
  "repeat": "<:repeat_ico:1557452911590506709>",
  "notify": "<:notify:1516966410373300325>",
  "like": "<:like:1530629327945994443>",
  "shopcart": "<:carrinho:1534594615544385736>",
  "review": "<:revcompra:1519178044995014666>",
  "check_circle": "<:circle_check:1557452832528015460>",
  "alert": "<:circle_alert:1557452852509802546>",
  "x": "<:x67:1548708925480771724>",
  "othergear": "<:othergear:1519193411251470367>",
  "random": "<:eutambmtenho29:1516966640229548062>"
};
// Usa os IDs originais; jamais substitui silenciosamente por emojis Unicode.
// Quando existir uma cópia instalada no servidor, usa a cópia local.
let clientRef;
export const bindEmojiClient = client => { clientRef = client; };
export const emoji = (key, guild = null) => {
  const raw = EMOJIS[key];
  if (!raw) throw new Error(`Emoji não cadastrado: ${key}`);
  const match = /^<(a?):([^:]+):(\d+)>$/.exec(raw);
  if (!match) throw new Error(`Emoji inválido: ${key}`);
  const local = guild?.emojis?.cache?.find(e => e.name === match[2]);
  const global = clientRef?.emojis?.cache?.get(match[3]);
  const found = local || global;
  return found ? { id: found.id, name: found.name, animated: found.animated } : { id: match[3], name: match[2], animated: Boolean(match[1]) };
};
export const icon = key => EMOJIS[key] || '';
// Nunca usar emojis Unicode como substitutos.
