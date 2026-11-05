// Dev-only fake API (npm run dev:mock): lets the web UI run without Telegram. Password: demo
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

type T = 'video' | 'pdf' | 'image' | 'album' | 'file';
interface It {
  id: string;
  categoryId: string;
  chatId: string;
  messageIds: number[];
  type: T;
  albumItems?: { messageId: number; type: 'image' | 'video' }[];
  title: string;
  caption: string;
  description: string;
  tags: string[];
  fileName?: string;
  size?: number;
  duration?: number;
  favorite: boolean;
  postedAt: string;
}

const CATS = [
  { id: '-1001', chatId: '-1001', topicId: null, name: 'งานแต่ง', groupName: null, order: 0 },
  {
    id: '-1002:7',
    chatId: '-1002',
    topicId: 7,
    name: 'ซ้อมดนตรี',
    groupName: 'SGT',
    emoji: '🎵',
    order: 0,
  },
  {
    id: '-1002:9',
    chatId: '-1002',
    topicId: 9,
    name: 'งานกีฬาสี เขต 11',
    groupName: 'SGT',
    emoji: '🏅',
    order: 1,
  },
  {
    id: '-1002:11',
    chatId: '-1002',
    topicId: 11,
    name: 'เอกสารประชุม',
    groupName: 'SGT',
    order: 2,
    closed: true,
  },
];
const TITLES = [
  'ซ้อมเพลง Heal the World รอบ 2',
  'งานกีฬาสี เขต 11 ภาคเช้า',
  'สรุปประชุมประจำเดือน',
  'พิธีเปิดงาน',
  'เพลงประกอบพิธี',
  'ถ่ายรูปหมู่',
  'Rehearsal take 3',
  'บันทึกการแข่งขันฟุตบอล',
  'ตารางกิจกรรมทั้งหมด',
];
const TAGS = ['ซ้อม', 'ดนตรี', 'กีฬา', 'ประชุม', 'ภาพหมู่'];
const TYPES: T[] = ['video', 'album', 'pdf', 'video', 'image', 'album', 'video', 'pdf'];

const items: It[] = Array.from({ length: 83 }, (_, n) => {
  const cat = CATS[n % CATS.length];
  const type = TYPES[n % TYPES.length];
  const base = 1000 + n * 10;
  const k = type === 'album' ? 6 : 1;
  return {
    id: `${cat.chatId}_${base}`,
    categoryId: cat.id,
    chatId: cat.chatId,
    type,
    messageIds: Array.from({ length: k }, (_, j) => base + j),
    ...(type === 'album' && {
      albumItems: Array.from({ length: k }, (_, j) => ({
        messageId: base + j,
        type: (j === 3 ? 'video' : 'image') as 'image' | 'video',
      })),
    }),
    title: `${TITLES[n % TITLES.length]}${n >= TITLES.length ? ` #${n}` : ''}`,
    caption: n % 4 === 0 ? 'ถ่ายโดยทีมงาน\nขอบคุณทุกคนที่มาร่วม' : '',
    description:
      n % 3 === 0
        ? 'ซ้อมก่อนงานจริง 2 วัน เสียงยังไม่ค่อยประสาน ต้องซ้อมท่อนที่สองอีกรอบ\nอัปโหลดเวอร์ชันสุดท้ายแล้วใน topic นี้'
        : '',
    tags: n % 2 ? [TAGS[n % 5]] : [TAGS[n % 5], TAGS[(n + 2) % 5]],
    fileName: type === 'pdf' ? 'meeting.pdf' : type === 'video' ? `VID_${n}.mp4` : undefined,
    size: type === 'video' ? 52_000_000 + n : 800_000,
    duration: type === 'video' ? 30 + n * 7 : undefined,
    favorite: n % 7 === 0,
    postedAt: new Date(Date.UTC(2025, 9, 30) - n * 86_400_000).toISOString(),
  };
});

const norm = (s: string) => s.toLowerCase().normalize('NFC');
const send = (
  res: ServerResponse,
  code: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const svg = (label: string, hue: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="hsl(${hue} 55% 42%)"/><text x="320" y="190" fill="#fff" font-size="40" text-anchor="middle" font-family="sans-serif">${label.replace(/[<&]/g, '')}</text></svg>`;

function pdf(pages: number): Buffer {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push(
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
  );
  for (let i = 0; i < pages; i++) {
    const body = `BT /F1 36 Tf 60 700 Td (Mock PDF page ${i + 1}) Tj ET`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${3 + pages * 2} 0 R >> >> >>`,
      `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out);
}

function range(req: IncomingMessage, res: ServerResponse, buf: Buffer, type: string) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const base = { 'Accept-Ranges': 'bytes', 'Content-Type': type };
  if (!m) {
    res.writeHead(200, { ...base, 'Content-Length': buf.length });
    return res.end(buf);
  }
  const s = m[1] ? Number(m[1]) : Math.max(buf.length - Number(m[2]), 0);
  const e = m[1] && m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
  res.writeHead(206, {
    ...base,
    'Content-Range': `bytes ${s}-${e}/${buf.length}`,
    'Content-Length': e - s + 1,
  });
  res.end(buf.subarray(s, e + 1));
}

export function mockApi(): Plugin {
  const video = readFileSync(join(import.meta.dirname, 'sample.mp4'));
  const pdfBuf = pdf(5);
  let bad = 0;
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const p = url.pathname;
        if (!p.startsWith('/api/')) return next();
        const authed = /(^|; )tgv_session=demo/.test(req.headers.cookie ?? '');
        if (p === '/api/login' && req.method === 'POST') {
          let b = '';
          req.on('data', (c) => (b += c));
          return req.on('end', () => {
            if (bad >= 5)
              return send(
                res,
                429,
                { error: 'rate_limited', retryAfter: 12 },
                { 'Retry-After': '12' },
              );
            if (JSON.parse(b || '{}').password !== 'demo') {
              bad++;
              return send(res, 401, { error: 'invalid_password' });
            }
            bad = 0;
            send(
              res,
              200,
              { ok: true },
              {
                'Set-Cookie': 'tgv_session=demo; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000',
              },
            );
          });
        }
        if (!authed) return send(res, 401, { error: 'unauthorized' });
        const [, , seg, a, b2] = p.split('/');
        if (seg === 'me') return send(res, 200, { ok: true });
        if (seg === 'categories') {
          return send(
            res,
            200,
            CATS.map((c) => {
              const l = items.filter((i) => i.categoryId === c.id);
              return { ...c, count: l.length, favorites: l.filter((i) => i.favorite).length };
            }),
          );
        }
        if (seg === 'tags') {
          const n = new Map<string, number>();
          for (const i of items)
            if (
              !url.searchParams.get('category') ||
              i.categoryId === url.searchParams.get('category')
            )
              for (const t of i.tags) n.set(t, (n.get(t) ?? 0) + 1);
          return send(
            res,
            200,
            [...n].map(([tag, count]) => ({ tag, count })).sort((x, y) => y.count - x.count),
          );
        }
        if (seg === 'items' && !a) {
          const q = url.searchParams;
          const types = q.get('type')?.split(',');
          const terms = norm(q.get('q') ?? '')
            .split(/\s+/)
            .filter((w) => w && !w.startsWith('#'));
          const list = items.filter(
            (i) =>
              (!q.get('category') || i.categoryId === q.get('category')) &&
              (!types || types.includes(i.type)) &&
              (!q.get('fav') || i.favorite) &&
              (!q.get('tag') || i.tags.includes(q.get('tag')!)) &&
              terms.every((t) =>
                norm(
                  `${i.title} ${i.caption} ${i.description} ${i.fileName ?? ''} ${i.tags.join(' ')}`,
                ).includes(t),
              ),
          );
          const from = Number(q.get('cursor') ?? 0),
            lim = Math.min(Number(q.get('limit') ?? 30), 60);
          return send(res, 200, {
            items: list.slice(from, from + lim),
            nextCursor: from + lim < list.length ? String(from + lim) : null,
          });
        }
        if (seg === 'items' && a) {
          const it = items.find((i) => i.id === decodeURIComponent(a));
          if (!it) return send(res, 404, { error: 'not_found' });
          if (b2 === 'favorite' && req.method === 'PUT') {
            let b = '';
            req.on('data', (c) => (b += c));
            return req.on('end', () => {
              if (it.categoryId === '-1002:9')
                return send(res, 422, {
                  error: 'chat_reaction_disabled',
                  message: 'ห้อง/กลุ่มนี้ไม่เปิด reaction ❤️ — เปิดได้ในตั้งค่าแชท',
                });
              setTimeout(() => {
                it.favorite = !!JSON.parse(b).favorite;
                send(res, 200, it);
              }, 250);
            });
          }
          return send(res, 200, it);
        }
        if (seg === 'thumb' || seg === 'file') {
          const it = items.find((i) => i.chatId === a && i.messageIds.includes(Number(b2)));
          if (!it) return send(res, 404, { error: 'not_found' });
          if (seg === 'thumb') {
            if (it.type === 'pdf') return send(res, 404, { error: 'no_thumbnail' });
            res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
            return res.end(svg(it.type === 'video' ? '▶' : '▣', it.messageIds[0] % 360));
          }
          if (it.type === 'pdf') return range(req, res, pdfBuf, 'application/pdf');
          const sub = it.albumItems?.find((x) => x.messageId === Number(b2));
          if (it.type === 'video' || sub?.type === 'video')
            return range(req, res, video, 'video/mp4');
          res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
          return res.end(
            svg(
              `${Number(b2) - it.messageIds[0] + 1} / ${it.messageIds.length}`,
              (Number(b2) * 37) % 360,
            ),
          );
        }
        send(res, 404, { error: 'not_found' });
      });
    },
  };
}
