import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2; // default 32 MiB is exactly at the limit for N=2^15

const derive = (pw: string, salt: Buffer): Promise<Buffer> =>
  new Promise((res, rej) =>
    scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM }, (e, k) =>
      e ? rej(e) : res(k),
    ),
  );

/** → `scrypt$<salt-b64>$<hash-b64>` */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pw, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h, extra] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h || extra !== undefined) return false;
  const want = Buffer.from(h, 'base64');
  if (want.length !== KEYLEN) return false;
  const got = await derive(pw, Buffer.from(s, 'base64'));
  return timingSafeEqual(got, want);
}
