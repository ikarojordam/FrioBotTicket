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
  "help": "<:circle_help:1557452846281007274>"
};
export const emoji = (key) => { const raw=EMOJIS[key]; if (!raw) return undefined; const m=/^<(a?):([^:]+):(\d+)>$/.exec(raw); return m ? {id:m[3],name:m[2],animated:m[1]==="a"} : undefined; };
export const icon = (key) => EMOJIS[key] || "";
