import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'tgv_session';
export const MAX_AGE_S = 400 * 24 * 3600; // Chrome caps cookie lifetime at 400 days → slide it on use

export interface Payload {
  sid: string;
  v: number;
  iat: number;
}

const mac = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64url');

/** `base64url(payload).HMAC` – no expiry inside the token; revoke everything by bumping SESSION_VERSION. */
export function signSession(secret: string, version: number, now = Date.now()): string {
  const p: Payload = {
    sid: randomBytes(16).toString('hex'),
    v: version,
    iat: Math.floor(now / 1000),
  };
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${mac(secret, body)}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  version: number,
): Payload | null {
  if (!token) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
    return p.v === version && typeof p.sid === 'string' ? p : null;
  } catch {
    return null;
  }
}
