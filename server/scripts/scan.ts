import { join } from 'node:path';
import { config, requireTgApp, requireTgSession } from '../src/config.js';
import { fullScan } from '../src/index/scanner.js';
import { searchItems } from '../src/index/search.js';
import { saveSnapshot } from '../src/index/snapshot.js';
import { createClient } from '../src/telegram/client.js';

const qi = process.argv.indexOf('--q');
const q = qi > -1 ? process.argv[qi + 1] : undefined;

const { apiId, apiHash } = requireTgApp();
const client = createClient(apiId, apiHash, requireTgSession());
await client.connect();

const t0 = Date.now();
const store = await fullScan(client, (s) => console.log(' ', s));
const file = join(config.dataDir, 'index.json');
await saveSnapshot(file, store.toSnapshot());

console.log(`\nscan done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${file}\n`);
for (const c of store.categoryStats().sort((a, b) => a.order - b.order)) {
  const name = c.groupName ? `${c.groupName} / ${c.emoji ?? ''}${c.name}` : c.name;
  console.log(`  ${c.id.padEnd(22)} ${name}  (${c.count} items, ${c.favorites} ❤️)`);
}
const show = q
  ? searchItems(store.allItems(), { q, limit: 10 })
  : searchItems(store.allItems(), { limit: 5 });
console.log(`\n${q ? `search "${q}"` : 'latest 5'}:`);
for (const it of show.items) {
  console.log(
    `  [${it.type}${it.favorite ? ' ❤️' : ''}] ${it.title}  ${it.tags.map((t) => '#' + t).join(' ')}`,
  );
  if (it.description) console.log(`      ↳ ${it.description.replace(/\n/g, ' / ').slice(0, 100)}`);
}
await client.destroy();
process.exit(0);
