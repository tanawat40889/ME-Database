import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { LiveEvent } from '../index/live.js';
import { listTags, searchItems, type Query } from '../index/search.js';
import type { IndexStore } from '../index/store.js';
import type { Item, ItemType } from '../index/types.js';
import { FavoriteError } from '../telegram/reactions.js';
import { verifyPassword } from './password.js';
import { LoginLimiter } from './ratelimit.js';
import { parseRange, sliceRange } from './range.js';
import { Semaphore } from './semaphore.js';
import { COOKIE, MAX_AGE_S, signSession, verifySession } from './session.js';
import type { Gateway } from './types.js';

export interface AppDeps {
  cfg: {
    passwordHash: string;
    sessionSecret: string;
    sessionVersion: number;
    cookieSecure: boolean;
    trustProxy: boolean;
    dataDir: string;
    maxDownloads: number;
    webDir?: string;
  };
  getStore(): IndexStore;
  status(): { ready: boolean; connected: boolean } & Record<string, unknown>;
  gateway: Gateway;
  isVault(chatId: string): boolean;
  /** apply an index event right now (used after a favorite toggle) */
  applyNow(ev: LiveEvent): void;
  now?: () => number;
}

const DAY = 24 * 3600 * 1000;
const ITEM_TYPES = new Set<string>(['video', 'pdf', 'image', 'album', 'file']);
const ID = /^-?\d{1,20}$/;
/** only these may render inline on our origin; everything else is forced to download */
const INLINE_MIME = /^(video|audio)\/|^image\/(png|jpe?g|gif|webp|avif|heic)$|^application\/pdf$/i;

const dto = ({ searchText: _s, ...rest }: Item) => rest;
const first = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { cfg, gateway } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({
    trustProxy: cfg.trustProxy,
    bodyLimit: 16 * 1024,
    logger: false,
    forceCloseConnections: true,
  });
  const limiter = new LoginLimiter();
  const refreshed = new Map<string, number>(); // sid → last cookie refresh
  const fileSlots = new Semaphore(cfg.maxDownloads);
  const thumbSlots = new Semaphore(cfg.maxDownloads);
  const thumbsDir = join(cfg.dataDir, 'thumbs');
  const noThumb = new Set<string>();
  const thumbInflight = new Map<string, Promise<Buffer | null>>();

  const sweeper = setInterval(() => limiter.sweep(now()), 10 * 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));

  await app.register(fastifyCookie);

  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: cfg.cookieSecure,
      sameSite: 'lax',
      maxAge: MAX_AGE_S,
    });

  const sessionOf = (req: FastifyRequest) =>
    verifySession(req.cookies[COOKIE], cfg.sessionSecret, cfg.sessionVersion);

  // ---- gate: security headers, same-origin check, session on every /api/* ----
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch {
          /* bad origin → mismatch below */
        }
        if (host !== req.headers.host) return reply.code(403).send({ error: 'bad_origin' });
      }
    }

    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || path === '/api/login' || path === '/api/logout') return;

    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'unauthorized' });

    // sliding: re-issue the same token with a fresh 400 days, at most once a day per session
    const last = refreshed.get(s.sid);
    if (last === undefined || now() - last > DAY) {
      refreshed.set(s.sid, now());
      setCookie(reply, req.cookies[COOKIE]!);
    }
  });

  const ready = (reply: FastifyReply) => {
    if (deps.status().ready) return true;
    reply.code(503).send({ error: 'indexing' });
    return false;
  };

  // ---- auth ----
  app.post('/api/login', async (req, reply) => {
    const gate = limiter.attempt(req.ip, now());
    if (!gate.ok) {
      return reply
        .code(429)
        .header('Retry-After', String(gate.retryAfter))
        .send({ error: 'rate_limited', retryAfter: gate.retryAfter });
    }
    const pw = (req.body as { password?: unknown } | null)?.password;
    const ok =
      typeof pw === 'string' &&
      pw.length > 0 &&
      pw.length <= 1024 &&
      (await verifyPassword(pw, cfg.passwordHash));
    if (!ok) {
      limiter.fail(req.ip, now());
      return reply.code(401).send({ error: 'invalid_password' });
    }
    limiter.success(req.ip);
    setCookie(reply, signSession(cfg.sessionSecret, cfg.sessionVersion, now()));
    return { ok: true };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async () => ({ ok: true }));

  // ---- data ----
  app.get('/api/categories', async (_req, reply) => {
    if (!ready(reply)) return;
    return deps
      .getStore()
      .categoryStats()
      .sort(
        (a, b) =>
          a.chatId.localeCompare(b.chatId) ||
          a.order - b.order ||
          a.name.localeCompare(b.name, 'th'),
      );
  });

  app.get('/api/items', async (req, reply) => {
    if (!ready(reply)) return;
    const q = req.query as Record<string, unknown>;
    const types = first(q.type)?.split(',').filter(Boolean);
    if (types?.some((t) => !ITEM_TYPES.has(t))) return reply.code(400).send({ error: 'bad_type' });
    const sort = first(q.sort);
    if (sort !== undefined && sort !== 'new' && sort !== 'old')
      return reply.code(400).send({ error: 'bad_sort' });
    const limit = first(q.limit) === undefined ? undefined : Number(q.limit);
    if (limit !== undefined && !Number.isInteger(limit))
      return reply.code(400).send({ error: 'bad_limit' });

    const query: Query = {
      category: first(q.category),
      type: types?.length ? (types as ItemType[]) : undefined,
      q: first(q.q)?.slice(0, 200),
      tag: first(q.tag)?.slice(0, 100),
      fav: q.fav === '1' || q.fav === 'true',
      sort,
      cursor: first(q.cursor)?.slice(0, 200),
      limit,
    };
    const page = searchItems(deps.getStore().allItems(), query);
    return { items: page.items.map(dto), nextCursor: page.nextCursor };
  });

  app.get('/api/items/:id', async (req, reply) => {
    if (!ready(reply)) return;
    const it = deps.getStore().getItem((req.params as { id: string }).id);
    return it ? dto(it) : reply.code(404).send({ error: 'not_found' });
  });

  app.put('/api/items/:id/favorite', async (req, reply) => {
    if (!ready(reply)) return;
    const fav = (req.body as { favorite?: unknown } | null)?.favorite;
    if (typeof fav !== 'boolean')
      return reply.code(400).send({ error: 'favorite must be boolean' });
    const id = (req.params as { id: string }).id;
    const it = deps.getStore().getItem(id);
    if (!it || !deps.isVault(it.chatId)) return reply.code(404).send({ error: 'not_found' });

    const rep = it.messageIds[0]; // an album is represented by its first message
    try {
      await gateway.setFavorite(it.chatId, rep, fav);
    } catch (e) {
      if (e instanceof FavoriteError) {
        const status =
          e.code === 'chat_reaction_disabled' ? 422 : e.code === 'not_found' ? 404 : 502;
        return reply.code(status).send({ error: e.code, message: e.message });
      }
      return reply.code(502).send({ error: 'telegram_unavailable' });
    }
    deps.applyNow({ t: 'reaction', chatId: it.chatId, id: rep, favorite: fav });
    const cur = deps.getStore().getItem(id);
    return cur ? dto(cur) : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/tags', async (req, reply) => {
    if (!ready(reply)) return;
    return listTags(
      deps.getStore().allItems(),
      first((req.query as Record<string, unknown>).category),
    );
  });

  // ---- media (thumbnail + Range streaming) ----
  const mediaParams = (req: FastifyRequest) => {
    const { chatId, messageId } = req.params as { chatId: string; messageId: string };
    if (!ID.test(chatId) || !ID.test(messageId)) return null;
    // must be a vault chat AND a media message the index knows about
    if (!deps.isVault(chatId)) return null;
    if (!deps.getStore().mediaMessage(chatId, Number(messageId))) return null;
    return { chatId, msgId: Number(messageId) };
  };

  async function loadThumb(chatId: string, msgId: number): Promise<Buffer | null> {
    const key = `${chatId}_${msgId}`;
    const file = join(thumbsDir, `${key}.jpg`);
    try {
      return await readFile(file);
    } catch {
      /* not cached yet */
    }
    if (noThumb.has(key)) return null;
    let p = thumbInflight.get(key);
    if (!p) {
      p = (async () => {
        const release = await thumbSlots.acquire();
        try {
          const buf = await gateway.thumb(chatId, msgId);
          if (!buf) {
            noThumb.add(key);
            return null;
          }
          await mkdir(thumbsDir, { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          await writeFile(tmp, buf);
          await rename(tmp, file);
          return buf;
        } finally {
          release();
        }
      })().finally(() => thumbInflight.delete(key));
      thumbInflight.set(key, p);
    }
    return p;
  }

  app.get('/api/thumb/:chatId/:messageId', async (req, reply) => {
    const m = mediaParams(req);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    let buf: Buffer | null;
    try {
      buf = await loadThumb(m.chatId, m.msgId);
    } catch {
      return reply.code(502).send({ error: 'telegram_unavailable' });
    }
    if (!buf) return reply.code(404).send({ error: 'no_thumbnail' });
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=86400')
      .send(buf);
  });

  app.get('/api/file/:chatId/:messageId', async (req, reply) => {
    const m = mediaParams(req);
    if (!m) return reply.code(404).send({ error: 'not_found' });

    let src;
    try {
      src = await gateway.fileSource(m.chatId, m.msgId);
    } catch {
      return reply.code(502).send({ error: 'telegram_unavailable' });
    }
    if (!src) return reply.code(404).send({ error: 'not_found' });

    const range = parseRange(req.headers.range, src.size);
    if (range.kind === 'invalid') {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${src.size}`)
        .send({ error: 'bad_range' });
    }
    const start = range.kind === 'partial' ? range.start : 0;
    const end = range.kind === 'partial' ? range.end : src.size - 1;

    const inline = INLINE_MIME.test(src.mime);
    const name = src.name ?? `${m.chatId}_${m.msgId}`;
    reply
      .code(range.kind === 'partial' ? 206 : 200)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', inline ? src.mime : 'application/octet-stream')
      .header('Content-Length', String(end - start + 1))
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`,
      )
      .header('Cache-Control', 'private, max-age=3600');
    // sandbox would block Chrome's built-in PDF viewer, and inline types are never active content
    if (!inline) reply.header('Content-Security-Policy', 'sandbox');
    if (range.kind === 'partial')
      reply.header('Content-Range', `bytes ${start}-${end}/${src.size}`);

    if (src.size === 0) return reply.send('');

    // wait for a download slot; give up if the client leaves meanwhile
    const ac = new AbortController();
    let release: (() => void) | null = null;
    const done = () => {
      ac.abort();
      release?.(); // idempotent; also covers a stream that never started
    };
    reply.raw.on('close', done);
    try {
      release = await fileSlots.acquire(ac.signal);
    } catch {
      return reply; // client went away while queued
    }
    if (ac.signal.aborted) {
      release();
      return reply;
    }
    const body = Readable.from(sliceRange((off) => src.open(off, end + 1), start, end, src.align));
    return reply.send(body);
  });

  // ---- health: public = minimal, with a session = full ----
  app.get('/health', async (req) => {
    const st = deps.status();
    if (sessionOf(req)) return { ok: true, ...st };
    return { ok: true, ready: st.ready, connected: st.connected };
  });

  // ---- web (same origin) ----
  const webDir = cfg.webDir ? resolve(cfg.webDir) : null;
  const hasWeb = !!webDir && existsSync(join(webDir, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      cacheControl: false,
      setHeaders: (res, p) => {
        res.header(
          'Cache-Control',
          p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    if (hasWeb && (req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
