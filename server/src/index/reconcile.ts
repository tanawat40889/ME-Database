import type { ChatInfo } from '../telegram/vault.js';
import type { IndexStore } from './store.js';

export interface ReconcilePlan {
  remove: string[]; // drop from index now
  scan: string[]; // (re)scan: new chats, forum toggled, renamed
}

/** Diff what the index holds against the chats that currently pass the vault rules. */
export function planReconcile(store: IndexStore, vault: ChatInfo[]): ReconcilePlan {
  const now = new Map(vault.map((c) => [c.id, c]));
  const remove: string[] = [];
  const scan: string[] = [];

  for (const [id, have] of store.chats) {
    const c = now.get(id);
    if (!c) remove.push(id);
    else if (c.forum !== have.forum) {
      remove.push(id); // category ids change shape, start over
      scan.push(id);
    } else if (c.title !== have.title) scan.push(id);
  }
  for (const id of now.keys()) if (!store.chats.has(id)) scan.push(id);
  return { remove, scan };
}
