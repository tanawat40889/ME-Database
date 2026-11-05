import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { LoginLimiter } from './ratelimit.js';
import { signSession, verifySession } from './session.js';

describe('password', () => {
  it('hash format and round trip (Thai too)', async () => {
    const h = await hashPassword('รหัสลับ-123');
    expect(h).toMatch(/^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('รหัสลับ-123', h)).toBe(true);
    expect(await verifyPassword('รหัสลับ-124', h)).toBe(false);
  });
  it('salted: same password → different hashes', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });
  it('malformed stored values never verify', async () => {
    for (const bad of ['', 'plain', 'scrypt$a', 'scrypt$a$b', 'bcrypt$a$b', 'scrypt$a$b$c']) {
      expect(await verifyPassword('x', bad)).toBe(false);
    }
  });
}, 30_000);

describe('session token', () => {
  const S = 's'.repeat(32);
  it('round trip, no expiry field', () => {
    const t = signSession(S, 1);
    const p = verifySession(t, S, 1)!;
    expect(p.v).toBe(1);
    expect(Object.keys(p).sort()).toEqual(['iat', 'sid', 'v']);
  });
  it('still valid far in the future (no expiry in token)', () => {
    const t = signSession(S, 1, Date.now() - 5 * 365 * 24 * 3600 * 1000);
    expect(verifySession(t, S, 1)).not.toBeNull();
  });
  it('wrong secret, tampered body/sig, garbage → null', () => {
    const t = signSession(S, 1);
    const [b, sig] = t.split('.');
    expect(verifySession(t, 'x'.repeat(32), 1)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ sid: 'a', v: 1, iat: 0 })).toString('base64url');
    expect(verifySession(`${forged}.${sig}`, S, 1)).toBeNull();
    expect(verifySession(`${b}.${sig}x`, S, 1)).toBeNull();
    for (const g of [undefined, '', 'a', 'a.b', 'a.b.c']) expect(verifySession(g, S, 1)).toBeNull();
  });
  it('bumping SESSION_VERSION invalidates old tokens', () => {
    const t = signSession(S, 1);
    expect(verifySession(t, S, 2)).toBeNull();
  });
  it('unique sid per login', () => {
    expect(signSession(S, 1)).not.toBe(signSession(S, 1));
  });
});

describe('LoginLimiter', () => {
  const T = 1_000_000;
  it('5 attempts per minute per IP, then retryAfter', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 5; i++) expect(l.attempt('1.1.1.1', T + i * 1000).ok).toBe(true);
    const g = l.attempt('1.1.1.1', T + 6000);
    expect(g).toEqual({ ok: false, retryAfter: 54 });
    expect(l.attempt('2.2.2.2', T + 6000).ok).toBe(true); // other IP unaffected
    expect(l.attempt('1.1.1.1', T + 60_001).ok).toBe(true); // window slid
  });
  it('more than 20 failures within an hour locks the IP for an hour', () => {
    const l = new LoginLimiter();
    let t = T;
    for (let i = 0; i < 20; i++) {
      t += 61_000; // stay under the per-minute limit
      expect(l.attempt('a', t).ok).toBe(true);
      l.fail('a', t);
    }
    t += 61_000;
    expect(l.attempt('a', t).ok).toBe(true);
    l.fail('a', t); // 21st
    const g = l.attempt('a', t + 1000);
    expect(g.ok).toBe(false);
    expect((g as { retryAfter: number }).retryAfter).toBeGreaterThan(3500);
    expect(l.attempt('a', t + 3_600_001).ok).toBe(true);
  });
  it('20 failures are not enough to lock', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 20; i++) l.fail('b', T + i);
    expect(l.attempt('b', T + 100).ok).toBe(true);
  });
  it('success clears failure count; sweep drops idle records', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 20; i++) l.fail('c', T);
    l.success('c');
    l.fail('c', T);
    expect(l.attempt('c', T + 1).ok).toBe(true);
    l.sweep(T + 4_000_000);
    expect(l.attempt('c', T + 4_000_001).ok).toBe(true);
  });
});
