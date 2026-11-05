import { beforeEach, describe, expect, it } from 'vitest';
import {
  categoryName,
  clearVault,
  evaluateChat,
  isVaultChat,
  registerChat,
  removeChat,
  type ChatInfo,
} from './vault.js';

const mk = (o: Partial<ChatInfo> = {}): ChatInfo => ({
  id: '-1001',
  kind: 'supergroup',
  title: 'TBackup - ทดสอบ',
  usernames: [],
  forum: false,
  left: false,
  kicked: false,
  deactivated: false,
  ...o,
});

const reasons = (c: ChatInfo, p?: string) => {
  const v = evaluateChat(c, p);
  return v.ok ? [] : v.reasons;
};

describe('evaluateChat', () => {
  it('passes private supergroup with prefix', () => {
    expect(evaluateChat(mk()).ok).toBe(true);
  });
  it('passes forum supergroup', () => {
    expect(evaluateChat(mk({ forum: true })).ok).toBe(true);
  });
  it('passes basic group (always private)', () => {
    expect(evaluateChat(mk({ kind: 'group', id: '-5' })).ok).toBe(true);
  });
  it('rejects broadcast channel', () => {
    expect(reasons(mk({ kind: 'channel' })).join()).toContain('channel');
  });
  it('rejects user and bot', () => {
    expect(evaluateChat(mk({ kind: 'user' })).ok).toBe(false);
    expect(evaluateChat(mk({ kind: 'bot' })).ok).toBe(false);
  });
  it('rejects public username', () => {
    expect(reasons(mk({ usernames: ['pub'] })).join()).toContain('public');
  });
  it('title check is case-sensitive', () => {
    expect(reasons(mk({ title: 'tbackup x' })).join()).toContain('พิมพ์เล็ก/ใหญ่');
    expect(reasons(mk({ title: 'Backup x' })).join()).toContain('ไม่ขึ้นต้น');
  });
  it('trims title before checking', () => {
    expect(evaluateChat(mk({ title: '  TBackup x ' })).ok).toBe(true);
  });
  it('rejects prefix not at start', () => {
    expect(evaluateChat(mk({ title: 'My TBackup' })).ok).toBe(false);
  });
  it('rejects left / kicked / deactivated', () => {
    expect(reasons(mk({ left: true })).join()).toContain('ออกจากกลุ่ม');
    expect(reasons(mk({ kicked: true })).join()).toContain('เตะ');
    expect(reasons(mk({ deactivated: true })).join()).toContain('ปิด');
  });
  it('honours custom prefix', () => {
    expect(evaluateChat(mk({ title: 'Vault 1' }), 'Vault').ok).toBe(true);
    expect(evaluateChat(mk({ title: 'TBackup 1' }), 'Vault').ok).toBe(false);
  });
  it('collects multiple reasons', () => {
    expect(reasons(mk({ kind: 'channel', usernames: ['x'], title: 'foo' })).length).toBe(3);
  });
});

describe('categoryName', () => {
  it.each([
    ['TBackup - งานแต่ง', 'งานแต่ง'],
    ['TBackup_SGT', 'SGT'],
    ['TBackup:x', 'x'],
    ['TBackup | x', 'x'],
    ['  TBackup   x  ', 'x'],
    ['TBackup -_: | y', 'y'],
    ['TBackup', 'TBackup'],
    ['TBackup - ', 'TBackup -'],
    ['ทดสอบ', 'ทดสอบ'],
  ])('%s → %s', (t, out) => {
    expect(categoryName(t)).toBe(out);
  });
  it('custom prefix', () => {
    expect(categoryName('Vault - a', 'Vault')).toBe('a');
  });
});

describe('isVaultChat registry', () => {
  beforeEach(clearVault);

  it('false for unknown chat', () => {
    expect(isVaultChat('-1001')).toBe(false);
  });
  it('true after registering a passing chat; accepts number/bigint', () => {
    registerChat(mk());
    expect(isVaultChat('-1001')).toBe(true);
    expect(isVaultChat(-1001)).toBe(true);
    expect(isVaultChat(-1001n)).toBe(true);
  });
  it('never registers a failing chat', () => {
    registerChat(mk({ kind: 'channel' }));
    expect(isVaultChat('-1001')).toBe(false);
  });
  it('rename to non-matching title removes it', () => {
    registerChat(mk());
    registerChat(mk({ title: 'ทดสอบ' }));
    expect(isVaultChat('-1001')).toBe(false);
  });
  it('becoming public removes it', () => {
    registerChat(mk());
    registerChat(mk({ usernames: ['now_public'] }));
    expect(isVaultChat('-1001')).toBe(false);
  });
  it('removeChat removes it', () => {
    registerChat(mk());
    removeChat('-1001');
    expect(isVaultChat('-1001')).toBe(false);
  });
});
