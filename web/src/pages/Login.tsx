import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';

export function Login() {
  const { login } = useAuth();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || wait > 0 || !pw) return;
    setBusy(true);
    setError(null);
    try {
      await login(pw);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setWait(err.retryAfter ?? 60);
        setError(null);
      } else if (err instanceof ApiError && err.status === 401) setError('รหัสผ่านไม่ถูกต้อง');
      else setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
      setPw('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-semibold tracking-tight">TG Vault</h1>
        <label className="block">
          <span className="sr-only">รหัสผ่าน</span>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="รหัสผ่าน"
            aria-invalid={!!error}
            aria-describedby="login-msg"
            className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <p
          id="login-msg"
          role="alert"
          className="min-h-5 text-center text-sm text-rose-600 dark:text-rose-400"
        >
          {wait > 0 ? `ลองผิดหลายครั้งเกินไป — รออีก ${wait} วินาที` : error}
        </p>
        <button
          type="submit"
          disabled={busy || wait > 0 || !pw}
          className="h-12 w-full rounded-xl bg-indigo-600 font-medium text-white transition enabled:active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? 'กำลังตรวจสอบ…' : 'เข้า'}
        </button>
      </form>
    </main>
  );
}
