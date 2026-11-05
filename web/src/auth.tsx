import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onUnauthorized } from './api';

type Status = 'loading' | 'out' | 'in';
const Ctx = createContext<{ status: Status; login(pw: string): Promise<void> }>({
  status: 'loading',
  login: async () => {},
});
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    api.me().then(
      () => setStatus('in'),
      () => setStatus('out'),
    );
    return onUnauthorized(() => setStatus('out'));
  }, []);

  const login = useCallback(async (pw: string) => {
    await api.login(pw);
    setStatus('in');
  }, []);

  return <Ctx.Provider value={{ status, login }}>{children}</Ctx.Provider>;
}
