import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-2), { id, msg }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
