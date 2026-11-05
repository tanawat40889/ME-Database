import { describe, expect, it } from 'vitest';
import { planReconcile } from './reconcile.js';
import { IndexStore } from './store.js';
import type { ChatInfo } from '../telegram/vault.js';

const info = (id: string, o: Partial<ChatInfo> = {}): ChatInfo => ({
  id,
  kind: 'supergroup',
  title: `TBackup - ${id}`,
  usernames: [],
  forum: false,
  left: false,
  kicked: false,
  deactivated: false,
  ...o,
});
const store = (...c: ChatInfo[]) => {
  const s = new IndexStore();
  for (const x of c) s.setChat({ id: x.id, title: x.title, forum: x.forum, lastId: 5 });
  return s;
};

describe('planReconcile', () => {
  it('no change → empty plan', () => {
    expect(planReconcile(store(info('a')), [info('a')])).toEqual({ remove: [], scan: [] });
  });
  it('new chat (joined / created / renamed into the vault) → scan', () => {
    expect(planReconcile(store(info('a')), [info('a'), info('b')])).toEqual({
      remove: [],
      scan: ['b'],
    });
  });
  it('chat left the vault (renamed away, public, left, migrated) → remove', () => {
    expect(planReconcile(store(info('a'), info('b')), [info('a')])).toEqual({
      remove: ['b'],
      scan: [],
    });
  });
  it('renamed within the vault → rescan to refresh category names', () => {
    expect(planReconcile(store(info('a')), [info('a', { title: 'TBackup - new' })])).toEqual({
      remove: [],
      scan: ['a'],
    });
  });
  it('Topics turned on → remove and scan from scratch', () => {
    expect(planReconcile(store(info('a')), [info('a', { forum: true })])).toEqual({
      remove: ['a'],
      scan: ['a'],
    });
  });
  it('basic group upgraded to supergroup (id changes) → old removed, new scanned', () => {
    expect(planReconcile(store(info('-5', { kind: 'group' })), [info('-1001234567890')])).toEqual({
      remove: ['-5'],
      scan: ['-1001234567890'],
    });
  });
});
