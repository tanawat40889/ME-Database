const MIN = 60_000;
const HOUR = 3_600_000;

interface Rec {
  attempts: number[];
  fails: number[];
  lockedUntil: number;
}

export type Gate = { ok: true } | { ok: false; retryAfter: number };

/** Login limiter: 5 attempts/min/IP; more than 20 failures/hour/IP locks that IP for 1 hour. */
export class LoginLimiter {
  private recs = new Map<string, Rec>();

  constructor(
    private perMin = 5,
    private failsPerHour = 20,
  ) {}

  private rec(ip: string): Rec {
    let r = this.recs.get(ip);
    if (!r) this.recs.set(ip, (r = { attempts: [], fails: [], lockedUntil: 0 }));
    return r;
  }

  /** Call before checking the password. Counts the attempt when allowed. */
  attempt(ip: string, now = Date.now()): Gate {
    const r = this.rec(ip);
    if (r.lockedUntil > now)
      return { ok: false, retryAfter: Math.ceil((r.lockedUntil - now) / 1000) };
    r.attempts = r.attempts.filter((t) => now - t < MIN);
    if (r.attempts.length >= this.perMin) {
      return { ok: false, retryAfter: Math.ceil((r.attempts[0] + MIN - now) / 1000) };
    }
    r.attempts.push(now);
    return { ok: true };
  }

  fail(ip: string, now = Date.now()): void {
    const r = this.rec(ip);
    r.fails = r.fails.filter((t) => now - t < HOUR);
    r.fails.push(now);
    if (r.fails.length > this.failsPerHour) r.lockedUntil = now + HOUR;
  }

  success(ip: string): void {
    const r = this.recs.get(ip);
    if (r) r.fails = [];
  }

  /** drop idle records so the map cannot grow without bound */
  sweep(now = Date.now()): void {
    for (const [ip, r] of this.recs) {
      if (
        r.lockedUntil <= now &&
        r.attempts.every((t) => now - t >= MIN) &&
        r.fails.every((t) => now - t >= HOUR)
      ) {
        this.recs.delete(ip);
      }
    }
  }
}
