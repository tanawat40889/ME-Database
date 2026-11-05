import { requireTgApp, requireTgSession } from '../src/config.js';
import { IndexService } from '../src/index/service.js';
import { createClient } from '../src/telegram/client.js';

const { apiId, apiHash } = requireTgApp();
const svc = new IndexService(createClient(apiId, apiHash, requireTgSession()), undefined, true);
await svc.start();
console.log('\nwatching live updates (Ctrl+C to stop)…');

const bye = async () => {
  await svc.stop();
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
