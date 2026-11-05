// npm workspace scripts run with cwd=server/, so the root .env is one level up.
for (const p of ['.env', '../.env']) {
  try {
    process.loadEnvFile(p);
    break;
  } catch {
    /* not found, try next */
  }
}

const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env: ${k}`);
  return v;
};

export const config = {
  apiId: Number(process.env.TG_API_ID ?? 0),
  apiHash: process.env.TG_API_HASH ?? '',
  session: process.env.TG_SESSION ?? '',
  prefix: process.env.VAULT_TITLE_PREFIX ?? 'TBackup',
  favEmoji: process.env.FAVORITE_EMOJI ?? '❤️',
  descWindowMin: Number(process.env.DESCRIPTION_WINDOW_MIN ?? 0),
  rescanCron: process.env.RESCAN_CRON ?? '0 4 * * *',
  maxDownloads: Number(process.env.MAX_CONCURRENT_DOWNLOADS ?? 4),
  dataDir: process.env.DATA_DIR ?? './data',
  port: Number(process.env.PORT ?? 8080),
  sessionVersion: Number(process.env.SESSION_VERSION ?? 1),
  cookieSecure: process.env.COOKIE_SECURE !== '0', // set 0 only for plain-http local testing
  trustProxy: process.env.TRUST_PROXY === '1', // behind Cloudflare Tunnel / reverse proxy
  webDir: process.env.WEB_DIR ?? '../web/dist',
};

export const requireTgApp = () => {
  if (!config.apiId || !config.apiHash) throw new Error('Missing TG_API_ID / TG_API_HASH');
  return { apiId: config.apiId, apiHash: config.apiHash };
};

export const requireTgSession = () => {
  requireTgApp();
  return req('TG_SESSION');
};

/** Called by main.ts at startup; refuses to boot without auth secrets. */
export const requireAuthEnv = () => {
  const sessionSecret = req('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return { passwordHash: req('APP_PASSWORD_HASH'), sessionSecret };
};
