import { requireTgApp } from '../src/config.js';
import { createClient } from '../src/telegram/client.js';
import { ask } from './prompt.js';

const { apiId, apiHash } = requireTgApp();
const client = createClient(apiId, apiHash);

await client.start({
  phoneNumber: () => ask('Phone (+66…): '),
  phoneCode: () => ask('Code: '),
  password: () => ask('2FA password: ', true),
  onError: (e) => console.error(e.message),
});

const s = client.session.save() as unknown as string;
console.log('\nPut this in .env (treat like an account password, never commit):\n');
console.log(`TG_SESSION=${s}\n`);
await client.destroy();
process.exit(0);
