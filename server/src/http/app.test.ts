import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { replay } from '../index/live.js';
import { IndexStore } from '../index/store.js';
import type { RawMsg } from '../index/types.js';
import { FavoriteError } from '../telegram/reactions.js';
import { buildApp, type AppDeps } from './app.js';
import { hashPassword } from './password.js';
import type { FileSource, Gateway } from './types.js';

const C = '-1001234567890';
const SECRET = 'k'.repeat(40);
const PW = 'correct horse';
const byte = (i: number) => (i * 7 + 3) % 251;

const msg = (id: number, o: Partial<RawMsg> = {}): RawMsg => ({
  id,
  chatId: C,
  topicId: null,
  date: 1_700_000_000 + id,
  kind: 'text',
  text: '',
  favorite: false,
  ...o,
});

function mkStore() {
  const st = new IndexStore();
  st.setChat({ id: C, title: 'TBackup - ทดสอบ', forum: false, lastId: 0 });
  st.setCategory({ id: C, chatId: C, topicId: null, name: 'ทดสอบ', groupName: null, order: 0 });
  st.upsert([
    msg(1, {
      kind: 'media',
      media: { type: 'video', mimeType: 'video/mp4', fileName: 'ซ้อม.mp4', size: 100_000 },
    }),
    msg(2, { text: 'ซ้อมดนตรี #ซ้อม' }),
    msg(3, {
      kind: 'media',
      media: { type: 'pdf', mimeType: 'application/pdf', fileName: 'a.pdf' },
    }),
    msg(5, { kind: 'media', groupedId: 'g', media: { type: 'image' }, text: 'งานกีฬาสี' }),
    msg(6, { kind: 'media', groupedId: 'g', media: { type: 'image' } }),
    msg(8, { kind: 'media', media: { type: 'file', mimeType: 'text/html', fileName: 'x.html' } }),
  ]);
  st.rebuildAll();
  return st;
}

function mkGateway() {
  const data = Buffer.from(Array.from({ length: 100_000 }, (_, i) => byte(i)));
  const opens: number[] = [];
  const sources: Record<string, FileSource> = {
    [`${C}_1`]: {
      size: data.length,
      mime: 'video/mp4',
      name: 'ซ้อม เพลง.mp4',
      align: 4096,
      open(offset) {
        opens.push(offset);
        expect(offset % 4096).toBe(0); // Telegram would reject anything else
        return (async function* () {
          for (let p = offset; p < data.length; p += 8192)
            yield new Uint8Array(data.subarray(p, Math.min(p + 8192, data.length)));
        })();
      },
    },
    [`${C}_8`]: {
      size: 4,
      mime: 'text/html',
      name: 'x.html',
      align: 4096,
      open: async function* () {
        yield new Uint8Array(Buffer.from('<h1>'));
      },
    },
  };
  const thumbs: Record<string, Buffer | null> = {
    [`${C}_1`]: Buffer.from('JPEGDATA'),
    [`${C}_3`]: null,
  };
  const gw = {
    data,
    opens,
    thumbCalls: vi.fn(),
    favCalls: [] as [string, number, boolean][],
    favError: null as Error | null,
    fileSource: vi.fn(async (c: string, m: number) => sources[`${c}_${m}`] ?? null),
    thumb: vi.fn(async (c: string, m: number) => thumbs[`${c}_${m}`] ?? null),
    setFavorite: vi.fn(async (c: string, m: number, f: boolean) => {
      if (gw.favError) throw gw.favError;
      gw.favCalls.push([c, m, f]);
    }),
  };
  return gw;
}

let hash: string;
beforeAll(async () => void (hash = await hashPassword(PW)), 30_000);

let dir: string;
let clock = 1_800_000_000_000;
let store: IndexStore;
let gw: ReturnType<typeof mkGateway>;
let app: FastifyInstance;
let ready = true;

async function make(over: Partial<AppDeps['cfg']> = {}, webDir?: string) {
  return buildApp({
    cfg: {
      passwordHash: hash,
      sessionSecret: SECRET,
      sessionVersion: 1,
      cookieSecure: true,
      trustProxy: false,
      dataDir: dir,
      maxDownloads: 4,
      webDir,
      ...over,
    },
    getStore: () => store,
    status: () => ({ ready, connected: true, items: store.allItems().length }),
    gateway: gw as unknown as Gateway,
    isVault: (id) => id === C,
    applyNow: (ev) => replay(store, [ev], 'TBackup'),
    now: () => clock,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tgv-app-'));
  store = mkStore();
  gw = mkGateway();
  ready = true;
  app = await make();
});
afterAll(async () => {
  await app?.close();
});

const login = async (a = app, password = PW, ip = '9.9.9.9') =>
  a.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: ip });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(([] as unknown[]).concat(res.headers['set-cookie'])[0]).split(';')[0];
const authed = async (a = app) => ({ cookie: cookieOf(await login(a)) });

describe('gate: every /api/* needs a session', () => {
  const routes: [string, string][] = [
    ['GET', '/api/me'],
    ['GET', '/api/categories'],
    ['GET', '/api/items'],
    ['GET', `/api/items/${C}_1`],
    ['PUT', `/api/items/${C}_1/favorite`],
    ['GET', '/api/tags'],
    ['GET', `/api/thumb/${C}/1`],
    ['GET', `/api/file/${C}/1`],
    ['GET', '/api/does-not-exist'],
  ];
  it.each(routes)('%s %s → 401 without cookie', async (method, url) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      payload: method === 'PUT' ? { favorite: true } : undefined,
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('ทดสอบ'); // nothing from Telegram leaks
  });
  it('401 with a forged or wrong-secret cookie', async () => {
    const other = await make({ sessionSecret: 'z'.repeat(40) });
    const c = await authed(other);
    expect((await app.inject({ url: '/api/me', headers: c })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/me', headers: { cookie: 'tgv_session=a.b' } })).statusCode,
    ).toBe(401);
    await other.close();
  });
  it('bumping SESSION_VERSION kills existing cookies', async () => {
    const c = await authed();
    expect((await app.inject({ url: '/api/me', headers: c })).statusCode).toBe(200);
    const v2 = await make({ sessionVersion: 2 });
    expect((await v2.inject({ url: '/api/me', headers: c })).statusCode).toBe(401);
    await v2.close();
  });
});

describe('login', () => {
  it('wrong password → 401, no cookie', async () => {
    const res = await login(app, 'nope');
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
  it('missing / non-string password → 401', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/login',
          payload: {},
          remoteAddress: '8.8.8.8',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/login',
          payload: { password: 5 },
          remoteAddress: '8.8.8.8',
        })
      ).statusCode,
    ).toBe(401);
  });
  it('right password → cookie: HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=400d', async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(/^tgv_session=/);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=34560000'])
      expect(sc).toContain(part);
  });
  it('COOKIE_SECURE=0 drops Secure (local http only)', async () => {
    const a = await make({ cookieSecure: false });
    expect(String((await login(a)).headers['set-cookie'])).not.toContain('Secure');
    await a.close();
  });
  it('6th attempt within a minute → 429 + Retry-After, even with the right password', async () => {
    for (let i = 0; i < 5; i++) await login(app, 'bad', '7.7.7.7');
    const res = await login(app, PW, '7.7.7.7');
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json().retryAfter).toBeGreaterThan(0);
    expect((await login(app, PW, '6.6.6.6')).statusCode).toBe(200); // other IP fine
  });
  it('rejects a cross-origin login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: PW },
      headers: { origin: 'https://evil.example', host: 'vault.example' },
    });
    expect(res.statusCode).toBe(403);
  });
  it('accepts same-origin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: PW },
      remoteAddress: '5.5.5.5',
      headers: { origin: 'https://vault.example', host: 'vault.example' },
    });
    expect(res.statusCode).toBe(200);
  });
  it('logout clears the cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/logout' });
    expect(String(res.headers['set-cookie'])).toMatch(/tgv_session=;/);
  });
});

describe('sliding cookie', () => {
  it('re-issues the same token once per day, not on every request', async () => {
    const c = await authed();
    const r1 = await app.inject({ url: '/api/me', headers: c });
    expect(cookieOf(r1)).toBe(c.cookie);
    expect(String(r1.headers['set-cookie'])).toContain('Max-Age=34560000');
    expect(
      (await app.inject({ url: '/api/me', headers: c })).headers['set-cookie'],
    ).toBeUndefined();
    clock += 25 * 3600 * 1000;
    expect((await app.inject({ url: '/api/me', headers: c })).headers['set-cookie']).toBeDefined();
  });
});

describe('health', () => {
  it('public: minimal; with session: full', async () => {
    const pub = (await app.inject({ url: '/health' })).json();
    expect(pub).toEqual({ ok: true, ready: true, connected: true });
    const full = (await app.inject({ url: '/health', headers: await authed() })).json();
    expect(full.items).toBe(store.allItems().length);
  });
  it('data routes answer 503 while the first index is building', async () => {
    ready = false;
    const res = await app.inject({ url: '/api/items', headers: await authed() });
    expect(res.statusCode).toBe(503);
    expect((await app.inject({ url: '/health' })).json().ready).toBe(false);
  });
});

describe('categories / items / tags', () => {
  it('categories with counts', async () => {
    const res = await app.inject({ url: '/api/categories', headers: await authed() });
    expect(res.json()).toEqual([
      expect.objectContaining({ id: C, name: 'ทดสอบ', count: 4, favorites: 0 }),
    ]);
  });
  it('items: newest first, no searchText leaked', async () => {
    const { items, nextCursor } = (
      await app.inject({ url: '/api/items', headers: await authed() })
    ).json();
    expect(items.map((i: { id: string }) => i.id)).toEqual([
      `${C}_8`,
      `${C}_5`,
      `${C}_3`,
      `${C}_1`,
    ]);
    expect(nextCursor).toBeNull();
    expect(items[0]).not.toHaveProperty('searchText');
  });
  it('search Thai substring + #tag + filters', async () => {
    const h = await authed();
    const get = async (qs: string) =>
      (await app.inject({ url: `/api/items?${qs}`, headers: h }))
        .json()
        .items.map((i: { id: string }) => i.id);
    expect(await get(`q=${encodeURIComponent('ซ้อม')}`)).toEqual([`${C}_1`]);
    expect(await get(`q=${encodeURIComponent('#ซ้อม')}`)).toEqual([`${C}_1`]);
    expect(await get('type=pdf')).toEqual([`${C}_3`]);
    expect(await get('type=album')).toEqual([`${C}_5`]);
    expect(await get('type=image,album')).toEqual([`${C}_5`]);
    expect(await get('type=pdf,video')).toEqual([`${C}_3`, `${C}_1`]);
    expect(await get('fav=1')).toEqual([]);
    expect(await get(`category=${C}&sort=old&limit=2`)).toEqual([`${C}_1`, `${C}_3`]);
  });
  it('cursor paging', async () => {
    const h = await authed();
    const p1 = (await app.inject({ url: '/api/items?limit=3', headers: h })).json();
    expect(p1.items).toHaveLength(3);
    const p2 = (
      await app.inject({
        url: `/api/items?limit=3&cursor=${encodeURIComponent(p1.nextCursor)}`,
        headers: h,
      })
    ).json();
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual([`${C}_1`]);
  });
  it('limit is capped at 60; bad params → 400', async () => {
    const h = await authed();
    expect((await app.inject({ url: '/api/items?limit=9999', headers: h })).statusCode).toBe(200);
    for (const qs of ['type=zzz', 'type=pdf,zzz', 'sort=sideways', 'limit=abc']) {
      expect((await app.inject({ url: `/api/items?${qs}`, headers: h })).statusCode).toBe(400);
    }
  });
  it('item detail incl. albumItems; unknown → 404', async () => {
    const h = await authed();
    const it = (await app.inject({ url: `/api/items/${C}_5`, headers: h })).json();
    expect(it.albumItems).toHaveLength(2);
    expect((await app.inject({ url: '/api/items/nope', headers: h })).statusCode).toBe(404);
  });
  it('tags', async () => {
    const res = await app.inject({ url: `/api/tags?category=${C}`, headers: await authed() });
    expect(res.json()).toEqual([{ tag: 'ซ้อม', count: 1 }]);
  });
});

describe('favorite', () => {
  it('toggles Telegram reaction on the album’s first message and returns the updated item', async () => {
    const h = await authed();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/items/${C}_5/favorite`,
      headers: h,
      payload: { favorite: true },
    });
    expect(res.statusCode).toBe(200);
    expect(gw.favCalls).toEqual([[C, 5, true]]);
    expect(res.json().favorite).toBe(true);
    expect(store.getItem(`${C}_5`)?.favorite).toBe(true);
    const off = await app.inject({
      method: 'PUT',
      url: `/api/items/${C}_5/favorite`,
      headers: h,
      payload: { favorite: false },
    });
    expect(off.json().favorite).toBe(false);
  });
  it('validates body and item', async () => {
    const h = await authed();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/items/${C}_5/favorite`,
          headers: h,
          payload: { favorite: 'yes' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/items/x_1/favorite',
          headers: h,
          payload: { favorite: true },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('reaction disabled in chat → 422 with a readable message; index unchanged', async () => {
    gw.favError = new FavoriteError('chat_reaction_disabled', 'เปิด reaction ในตั้งค่าแชท');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/items/${C}_1/favorite`,
      headers: await authed(),
      payload: { favorite: true },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: 'chat_reaction_disabled',
      message: expect.stringContaining('reaction'),
    });
    expect(store.getItem(`${C}_1`)?.favorite).toBe(false);
  });
  it('unexpected gateway failure → 502', async () => {
    gw.favError = new Error('boom');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/items/${C}_1/favorite`,
      headers: await authed(),
      payload: { favorite: true },
    });
    expect(res.statusCode).toBe(502);
  });
});

describe('file streaming (Range)', () => {
  const get = async (range?: string, url = `/api/file/${C}/1`) =>
    app.inject({ url, headers: { ...(await authed()), ...(range ? { range } : {}) } });

  it('no Range → 200 whole file with Accept-Ranges', async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('100000');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.headers['content-security-policy']).toBeUndefined(); // inline media: no sandbox (PDF viewer)
    expect(res.rawPayload.equals(gw.data)).toBe(true);
  });
  it('bytes=0-1023 → 206 + Content-Range', async () => {
    const res = await get('bytes=0-1023');
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-1023/100000');
    expect(res.headers['content-length']).toBe('1024');
    expect(res.rawPayload.equals(gw.data.subarray(0, 1024))).toBe(true);
  });
  it.each([
    ['bytes=5000-9999', 5000, 9999], // offset not a multiple of 4096
    ['bytes=4097-4100', 4097, 4100],
    ['bytes=12345-', 12345, 99999],
    ['bytes=-1000', 99000, 99999],
    ['bytes=99999-99999', 99999, 99999],
  ])('%s returns exactly the right bytes', async (r, s, e) => {
    gw.opens.length = 0;
    const res = await get(r);
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes ${s}-${e}/100000`);
    expect(res.rawPayload.equals(gw.data.subarray(s, e + 1))).toBe(true);
    expect(gw.opens.every((o) => o % 4096 === 0)).toBe(true);
  });
  it('unsatisfiable / malformed → 416', async () => {
    for (const r of ['bytes=100000-', 'bytes=abc', 'bytes=5-1']) {
      const res = await get(r);
      expect(res.statusCode).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */100000');
    }
  });
  it('UTF-8 filename in Content-Disposition', async () => {
    const cd = String((await get('bytes=0-1')).headers['content-disposition']);
    expect(cd).toBe(`inline; filename*=UTF-8''${encodeURIComponent('ซ้อม เพลง.mp4')}`);
  });
  it('non-media types are forced to download (no inline HTML on our origin)', async () => {
    const res = await get(undefined, `/api/file/${C}/8`);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment/);
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('404 for non-vault chat, message the index does not know, text message, bad ids', async () => {
    const h = await authed();
    for (const u of [
      `/api/file/-1009999999999/1`,
      `/api/file/${C}/999`,
      `/api/file/${C}/2`,
      `/api/file/${C}/abc`,
      '/api/file/..%2F..%2Fetc/1',
    ]) {
      expect((await app.inject({ url: u, headers: h })).statusCode).toBe(404);
    }
    expect(gw.fileSource).not.toHaveBeenCalled(); // never reaches Telegram
  });
  it('502 when Telegram fails', async () => {
    gw.fileSource.mockRejectedValueOnce(new Error('x'));
    expect((await get()).statusCode).toBe(502);
  });
});

describe('thumbnails', () => {
  const get = async (id: number) =>
    app.inject({ url: `/api/thumb/${C}/${id}`, headers: await authed() });

  it('fetched lazily once, then served from data/thumbs', async () => {
    const a = await get(1);
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toBe('image/jpeg');
    expect(a.body).toBe('JPEGDATA');
    expect(await readdir(join(dir, 'thumbs'))).toEqual([`${C}_1.jpg`]);
    const b = await get(1);
    expect(b.body).toBe('JPEGDATA');
    expect(gw.thumb).toHaveBeenCalledTimes(1);
  });
  it('concurrent first requests share one Telegram download', async () => {
    const h = await authed();
    const rs = await Promise.all(
      [1, 2, 3].map(() => app.inject({ url: `/api/thumb/${C}/1`, headers: h })),
    );
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(gw.thumb).toHaveBeenCalledTimes(1);
  });
  it('no thumbnail (pdf) → 404, remembered', async () => {
    expect((await get(3)).statusCode).toBe(404);
    expect((await get(3)).statusCode).toBe(404);
    expect(gw.thumb).toHaveBeenCalledTimes(1);
  });
  it('unknown message / non-vault → 404 without touching Telegram', async () => {
    expect((await get(999)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: '/api/thumb/-1009999999999/1', headers: await authed() }))
        .statusCode,
    ).toBe(404);
    expect(gw.thumb).not.toHaveBeenCalled();
  });
});

describe('static web + SPA fallback', () => {
  let web: string;
  let spa: FastifyInstance;
  beforeEach(async () => {
    web = join(dir, 'web');
    await mkdir(join(web, 'assets'), { recursive: true });
    await writeFile(join(web, 'index.html'), '<!doctype html><title>TG Vault</title>');
    await writeFile(join(web, 'assets', 'app.js'), 'console.log(1)');
    spa = await make({}, web);
  });
  afterAll(async () => void (await spa?.close()));

  it('assets and index load without login and contain no Telegram data', async () => {
    const idx = await spa.inject({ url: '/' });
    expect(idx.statusCode).toBe(200);
    expect(idx.body).toContain('TG Vault');
    expect(idx.body).not.toContain('ทดสอบ');
    const js = await spa.inject({ url: '/assets/app.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['cache-control']).toContain('immutable');
  });
  it('any other page falls back to index.html; /api stays JSON', async () => {
    const deep = await spa.inject({ url: '/category/abc' });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('TG Vault');
    const api = await spa.inject({ url: '/api/nope', headers: await authed(spa) });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'not_found' });
  });
  it('without a web build, unknown paths are plain 404', async () => {
    expect((await app.inject({ url: '/anything' })).statusCode).toBe(404);
  });
});
