import type { Category, Item, ItemsPage, TagCount } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

const unauthorized = new Set<() => void>();
/** called whenever an API call (other than login) answers 401 */
export const onUnauthorized = (fn: () => void) => {
  unauthorized.add(fn);
  return () => void unauthorized.delete(fn);
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') unauthorized.forEach((f) => f());
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      retryAfter?: number;
    };
    throw new ApiError(
      res.status,
      body.error ?? 'error',
      body.message ?? body.error ?? `HTTP ${res.status}`,
      body.retryAfter ?? (Number(res.headers.get('Retry-After')) || undefined),
    );
  }
  return (await res.json()) as T;
}

const qs = (o: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v !== undefined && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => req<{ ok: true }>('/api/me'),
  login: (password: string) =>
    req<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  categories: () => req<Category[]>('/api/categories'),
  items: (p: {
    category?: string;
    q?: string;
    type?: string;
    tag?: string;
    fav?: boolean;
    cursor?: string;
    limit?: number;
  }) => req<ItemsPage>(`/api/items${qs(p)}`),
  item: (id: string) => req<Item>(`/api/items/${encodeURIComponent(id)}`),
  tags: (category?: string) => req<TagCount[]>(`/api/tags${qs({ category })}`),
  setFavorite: (id: string, favorite: boolean) =>
    req<Item>(`/api/items/${encodeURIComponent(id)}/favorite`, {
      method: 'PUT',
      body: JSON.stringify({ favorite }),
    }),
};

export const thumbUrl = (it: Pick<Item, 'chatId' | 'messageIds'>, i = 0) =>
  `/api/thumb/${it.chatId}/${it.messageIds[i]}`;
export const fileUrl = (chatId: string, messageId: number) => `/api/file/${chatId}/${messageId}`;
