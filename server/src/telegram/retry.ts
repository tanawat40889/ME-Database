const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface FloodLike {
  seconds?: number;
  errorMessage?: string;
}

const floodSeconds = (e: unknown): number | null => {
  const x = e as FloodLike | null;
  if (x && typeof x.seconds === 'number' && /FLOOD/.test(x.errorMessage ?? '')) return x.seconds;
  return null;
};

export interface TgOpts {
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Wrap every Telegram call: on FLOOD_WAIT, wait seconds+1 and retry. */
export async function tg<T>(fn: () => Promise<T>, o: TgOpts = {}): Promise<T> {
  const { retries = 5, sleep = sleepMs } = o;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const s = floodSeconds(e);
      if (s === null || i >= retries) throw e;
      await sleep((s + 1) * 1000);
    }
  }
}
