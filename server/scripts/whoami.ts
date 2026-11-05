import { requireTgApp, requireTgSession } from '../src/config.js';
import { createClient } from '../src/telegram/client.js';
import { tg } from '../src/telegram/retry.js';

const { apiId, apiHash } = requireTgApp();
const client = createClient(apiId, apiHash, requireTgSession());
await client.connect();

const me = await tg(() => client.getMe());
console.log({
  id: String(me.id),
  name: [me.firstName, me.lastName].filter(Boolean).join(' '),
  username: me.username ?? null,
  premium: !!me.premium,
});
await client.destroy();
process.exit(0);
