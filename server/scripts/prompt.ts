import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

export function ask(q: string, hidden = false): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, enc, cb) {
      if (!muted) process.stdout.write(chunk, enc);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((res) => {
    rl.question(q, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      res(a.trim());
    });
    muted = hidden;
  });
}
