import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** history back when we came from inside the app, else a fallback route (deep link / reload) */
export function useBack(fallback: string) {
  const nav = useNavigate();
  const loc = useLocation();
  return useCallback(
    () => (loc.key !== 'default' ? nav(-1) : nav(fallback, { replace: true })),
    [nav, loc.key, fallback],
  );
}
