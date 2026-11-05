import { config, requireAuthEnv, requireTgApp, requireTgSession } from './config.js';
import { buildApp } from './http/app.js';
import { IndexService } from './index/service.js';
import { createClient } from './telegram/client.js';
import { TgGateway } from './telegram/gateway.js';
import { isVaultChat } from './telegram/vault.js';

// refuse to boot without the auth secrets (SPEC §9.2)
const auth = requireAuthEnv();
const { apiId, apiHash } = requireTgApp();

const client = createClient(apiId, apiHash, requireTgSession());
const svc = new IndexService(client);

const app = await buildApp({
  cfg: {
    passwordHash: auth.passwordHash,
    sessionSecret: auth.sessionSecret,
    sessionVersion: config.sessionVersion,
    cookieSecure: config.cookieSecure,
    trustProxy: config.trustProxy,
    dataDir: config.dataDir,
    maxDownloads: config.maxDownloads,
    webDir: config.webDir,
  },
  getStore: () => svc.store,
  status: () => svc.status(),
  gateway: new TgGateway(client, config.favEmoji),
  isVault: isVaultChat,
  applyNow: (ev) => svc.applyNow(ev),
});

// listen first: the login page works while the first scan is still running
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`listening on :${config.port}`);
svc.start().catch((e) => {
  console.error('index service failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

// docker stop: drop open streams, flush the snapshot, exit (both at once so a long stream cannot delay the flush)
const bye = async () => {
  await Promise.allSettled([app.close(), svc.stop()]);
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
