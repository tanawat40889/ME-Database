export type ChatKind = 'user' | 'bot' | 'group' | 'supergroup' | 'channel';

/** Telegram-agnostic snapshot of a dialog, built from a GramJS entity. */
export interface ChatInfo {
  id: string; // Bot-API style peer id (-100… for channels)
  kind: ChatKind;
  title: string;
  /** active public usernames; empty for private */
  usernames: string[];
  forum: boolean;
  left: boolean;
  kicked: boolean;
  deactivated: boolean;
}

export type Verdict = { ok: true } | { ok: false; reasons: string[] };

export const DEFAULT_PREFIX = 'TBackup';

export function evaluateChat(c: ChatInfo, prefix = DEFAULT_PREFIX): Verdict {
  const reasons: string[] = [];

  if (c.kind === 'user') reasons.push('ไม่ใช่กลุ่ม (แชทส่วนตัว)');
  else if (c.kind === 'bot') reasons.push('ไม่ใช่กลุ่ม (bot)');
  else if (c.kind === 'channel') reasons.push('เป็น channel (broadcast)');

  if (c.usernames.length) reasons.push(`เป็น public (@${c.usernames[0]})`);

  const title = c.title.trim();
  if (!title.startsWith(prefix)) {
    reasons.push(
      title.toLowerCase().startsWith(prefix.toLowerCase())
        ? `ตัวพิมพ์เล็ก/ใหญ่ของ "${prefix}" ไม่ตรง`
        : `ชื่อไม่ขึ้นต้นด้วย "${prefix}"`,
    );
  }

  if (c.left) reasons.push('ออกจากกลุ่มแล้ว');
  if (c.kicked) reasons.push('ถูกเตะออกจากกลุ่ม');
  if (c.deactivated) reasons.push('กลุ่มถูกปิด/ย้ายไปแล้ว');

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

const SEPARATORS = /^[\s\-_:|]+/;

/** Category name = title without prefix and leading separators; falls back to full title. */
export function categoryName(title: string, prefix = DEFAULT_PREFIX): string {
  const t = title.trim();
  if (!t.startsWith(prefix)) return t;
  const rest = t.slice(prefix.length).replace(SEPARATORS, '').trim();
  return rest || t;
}

// ---- central registry: every Telegram touch must go through isVaultChat() ----

const vault = new Map<string, ChatInfo>();

/** Re-evaluate a chat; add it to the vault if it passes, otherwise drop it. Returns the verdict. */
export function registerChat(c: ChatInfo, prefix = DEFAULT_PREFIX): Verdict {
  const v = evaluateChat(c, prefix);
  if (v.ok) vault.set(c.id, c);
  else vault.delete(c.id);
  return v;
}

export function removeChat(chatId: string): void {
  vault.delete(chatId);
}

export function isVaultChat(chatId: string | number | bigint): boolean {
  return vault.has(String(chatId));
}

export function getVaultChat(chatId: string): ChatInfo | undefined {
  return vault.get(chatId);
}

export function vaultChats(): ChatInfo[] {
  return [...vault.values()];
}

export function clearVault(): void {
  vault.clear();
}
