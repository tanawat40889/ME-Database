import { config, requireTgApp, requireTgSession } from '../src/config.js';
import { createClient, toChatInfo } from '../src/telegram/client.js';
import { tg } from '../src/telegram/retry.js';
import { categoryName, evaluateChat } from '../src/telegram/vault.js';

const all = process.argv.includes('--all');
const { apiId, apiHash } = requireTgApp();
const client = createClient(apiId, apiHash, requireTgSession());
await client.connect();

const included: string[] = [];
const near: string[] = [];
const other: string[] = [];
const seen = new Set<string>();

const dialogs = await tg(() => client.getDialogs({ limit: undefined }));
for (const d of dialogs) {
  const c = toChatInfo(d.entity);
  if (!c || seen.has(c.id)) continue;
  seen.add(c.id);
  const v = evaluateChat(c, config.prefix);
  if (v.ok) {
    included.push(
      `  ${c.id}  [${c.kind}${c.forum ? ' forum' : ''}]  ${c.title}  →  หมวด: ${categoryName(c.title, config.prefix)}`,
    );
  } else {
    const line = `  ${c.id}  [${c.kind}]  ${c.title}\n      ✗ ${v.reasons.join('; ')}`;
    if (c.title.toLowerCase().includes(config.prefix.toLowerCase())) near.push(line);
    else other.push(line);
  }
}

console.log(`\nจะ index (${included.length}):`);
console.log(included.join('\n') || '  (ไม่มี)');
console.log(`\nเกือบผ่าน — ชื่อมี "${config.prefix}" แต่ไม่ผ่านเงื่อนไข (${near.length}):`);
console.log(near.join('\n') || '  (ไม่มี)');
if (all) {
  console.log(`\nแชทอื่น (${other.length}):`);
  console.log(other.join('\n') || '  (ไม่มี)');
} else {
  console.log(`\nแชทอื่น ${other.length} รายการถูกตัดออก (ใช้ --all เพื่อดู)`);
}
await client.destroy();
process.exit(0);
