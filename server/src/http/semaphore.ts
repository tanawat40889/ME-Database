export class Semaphore {
  private free: number;
  private waiters: {
    go: () => void;
    reject: (e: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }[] = [];

  constructor(n: number) {
    this.free = n;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /** Resolves with a release function. Rejects if `signal` aborts while queued. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error('aborted'));
    return new Promise((resolve, reject) => {
      const release = () => {
        const next = this.waiters.shift();
        if (next) {
          if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
          next.go();
        } else this.free++;
      };
      const take = () => {
        let done = false;
        resolve(() => {
          if (!done) {
            done = true;
            release();
          }
        });
      };
      if (this.free > 0) {
        this.free--;
        take();
        return;
      }
      const w: (typeof this.waiters)[number] = { go: take, reject, signal };
      if (signal) {
        w.onAbort = () => {
          this.waiters = this.waiters.filter((x) => x !== w);
          reject(new Error('aborted'));
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this.waiters.push(w);
    });
  }
}
