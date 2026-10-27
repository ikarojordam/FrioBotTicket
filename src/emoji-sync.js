import { PermissionFlagsBits } from 'discord.js';
import { EMOJIS } from './emojis.js';

// Importação explícita e idempotente: nunca substitui emojis existentes.
export async function syncGuildEmojis(guild) {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    throw new Error('O bot precisa da permissão Gerenciar Expressões (emojis) neste servidor.');
  }
  const existing = await guild.emojis.fetch();
  const sources = [...new Map(Object.values(EMOJIS).map(raw => {
    const m = /^<(a?):([^:]+):(\d+)>$/.exec(raw);
    return m ? [m[2], { name: m[2], id: m[3], animated: Boolean(m[1]) }] : [raw, null];
  }).filter(([,v])=>v)).values()];
  let created = 0, skipped = 0;
  const failed = [];
  for (const e of sources) {
    if (existing.some(x => x.name === e.name)) { skipped++; continue; }
    const url = `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}?size=128&quality=lossless`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 256 * 1024) throw new Error('Arquivo vazio ou maior que 256 KB');
      const item = await guild.emojis.create({ attachment: bytes, name: e.name, reason: 'Frio Tickets • sincronização autorizada de emojis' });
      existing.set(item.id, item);
      created++;
    } catch (error) { failed.push(`${e.name}: ${error.message}`); }
  }
  return { created, skipped, failed, total: sources.length };
}
