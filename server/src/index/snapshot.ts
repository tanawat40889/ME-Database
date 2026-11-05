import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Category, ChatMeta, RawMsg } from './types.js';

export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  version: number;
  savedAt: string;
  chats: ChatMeta[];
  categories: Category[];
  messages: RawMsg[];
}

/** temp file + rename so a crash never leaves a half-written snapshot. */
export async function saveSnapshot(file: string, snap: Snapshot): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(snap));
  await rename(tmp, file);
}

/** null when missing, corrupt or from another version: caller just rescans. */
export async function loadSnapshot(file: string): Promise<Snapshot | null> {
  try {
    const s = JSON.parse(await readFile(file, 'utf8')) as Snapshot;
    return s.version === SNAPSHOT_VERSION && Array.isArray(s.messages) ? s : null;
  } catch {
    return null;
  }
}

export class Debounced {
  private t: NodeJS.Timeout | null = null;
  constructor(
    private fn: () => Promise<void> | void,
    private ms = 10_000,
  ) {}
  trigger(): void {
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(() => void this.flush(), this.ms);
  }
  async flush(): Promise<void> {
    if (this.t) clearTimeout(this.t);
    this.t = null;
    await this.fn();
  }
}
