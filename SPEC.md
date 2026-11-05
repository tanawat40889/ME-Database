# TG Vault — ระบบคลังสื่อส่วนตัวที่ใช้ Telegram เป็นที่เก็บไฟล์

> Spec สำหรับเริ่มพัฒนาด้วย Claude Code (v2 — ไม่มี database)
> อ่านทั้งไฟล์ก่อนเริ่ม แล้วทำตาม Milestones ทีละขั้น ถามก่อนถ้าเจอจุดที่ spec ไม่ชัด

---

## 1. เป้าหมาย

สร้างเว็บแอปสำหรับ **เรียกดู ค้นหา และกด favorite วิดีโอ, PDF และชุดภาพ** ที่เก็บไว้ใน Telegram
โดยไม่ต้องเปิดแอป Telegram

- **Telegram คือแหล่งข้อมูลจริงเพียงแห่งเดียว (source of truth)** ไม่มี database
- **ดึงเฉพาะกลุ่ม private ที่ชื่อขึ้นต้นด้วย `TBackup`** เท่านั้น (ดูข้อ 4) แชทอื่นไม่แตะเลย
- **1 กลุ่ม (หรือ 1 topic) = 1 หมวด (category)**
- **อัปโหลด** = ส่งไฟล์เข้าแชทผ่านแอป Telegram ตามปกติ
- **คำอธิบายไฟล์** = caption และ **ข้อความ text ที่ส่งตามหลังไฟล์** (ดูข้อ 5)
- **Favorite** = reaction ❤️ บนข้อความใน Telegram กดจากเว็บแล้วไปขึ้นใน Telegram และกดจาก Telegram ก็ขึ้นในเว็บ (ดูข้อ 6)
- **ผู้ใช้** = เจ้าของคนเดียว **ต้องใส่รหัสผ่านก่อนเข้าเว็บทุกหน้า** รหัสเก็บไว้ที่หลังบ้านเท่านั้น
  เมื่อ login แล้ว **session ในเครื่องนั้นอยู่ถาวร** ไม่ต้องใส่รหัสซ้ำ (ดูข้อ 9.2)

### Non-goals (ยังไม่ทำในเฟสแรก)
- database ทุกชนิด (Supabase, SQLite)
- หลายผู้ใช้ หรือการแชร์รายหมวด
- อัปโหลดหรือแก้ไขไฟล์ผ่านหน้าเว็บ (ยกเว้นการกด favorite)
- เปิดให้คนทั่วไปเข้าดู (public)
- transcode วิดีโอ

---

## 2. สถาปัตยกรรม

```
┌──────────────┐   ส่งไฟล์ / ข้อความ / กด ❤️ ผ่านแอป Telegram
│  Telegram    │◄──────────────────────────────────── ผู้ใช้
│  Channels /  │
│  Topics      │
└──────┬───────┘
       │ MTProto (GramJS, login ด้วย user session)
┌──────▼───────────────────────────────────────┐
│  server/  (Node.js + TypeScript + Fastify)   │  ← process เดียว รันตลอด 24 ชม.
│  ├─ Scanner: ไล่ข้อความในแชทคลัง → สร้าง index   │
│  ├─ Live updates: new / edit / delete /      │
│  │   reaction / topic → อัปเดต index           │
│  ├─ In-memory index (+ snapshot JSON บนดิสก์)  │
│  ├─ Thumbnail cache บนดิสก์                    │
│  ├─ REST API + สตรีมไฟล์ (HTTP Range)           │
│  └─ เสิร์ฟ web (static build) ใน origin เดียวกัน   │
└──────▲───────────────────────────────────────┘
       │ same-origin, httpOnly cookie
┌──────┴──────────────┐
│  web/ (Vite+React)  │  build แล้วให้ server เสิร์ฟ
└─────────────────────┘
```

**ประเด็นสำคัญ**
- ใช้ **user session (MTProto)** แทน Bot API เพราะ Bot API โหลดไฟล์ได้แค่ 20 MB และอ่าน/กด reaction ในนามบัญชีเราไม่ได้
- **"ไม่มี DB" แต่มี index ในหน่วยความจำ** ซึ่งเป็นแค่ cache ที่สร้างใหม่จาก Telegram ได้เสมอ
  ถ้าลบไฟล์ snapshot ทิ้ง ระบบต้องสร้าง index กลับมาได้ครบเหมือนเดิม
- **server เสิร์ฟ web เองใน origin เดียวกัน** ทำให้ใช้ httpOnly cookie กับ `<video src>`, `<img src>`, pdf.js ได้ตรง ๆ ไม่ต้องมีระบบ signed URL
- server ต้องรันบนเครื่องที่เปิดตลอด (VPS / Railway / Fly.io / คอมที่บ้าน + Cloudflare Tunnel)
  **ห้ามใช้ Netlify Functions** เพราะติด timeout และขนาด response สำหรับการสตรีม
- การที่ server เชื่อมต่อด้วย user session ตลอด ยังนับเป็นการใช้งานบัญชี ช่วยกันบัญชีถูกลบเพราะไม่ได้ใช้งานไปในตัว

---

## 3. Tech Stack และโครงสร้าง repo

| ส่วน | เทคโนโลยี |
|---|---|
| Server | Node.js 20+, TypeScript, **Fastify**, **GramJS** (`telegram` package), `@fastify/static`, `@fastify/cookie` |
| Web | **Vite + React + TypeScript**, Tailwind, `pdfjs-dist`, lightbox สำหรับอัลบั้ม |
| Deploy | Docker image เดียว (server + web build) |

```
tg-vault/
├─ server/
│  ├─ src/
│  │  ├─ telegram/      # client, retry/FloodWait helper, reactions
│  │  ├─ index/         # in-memory index, scanner, live updates, snapshot, search
│  │  ├─ http/          # routes: auth, api, file streaming, static
│  │  ├─ config.ts
│  │  └─ main.ts
│  ├─ scripts/
│  │  ├─ login.ts       # สร้าง session string ครั้งแรก
│  │  ├─ whoami.ts
│  │  ├─ list-chats.ts  # แสดงกลุ่มที่ระบบจะ index (และกลุ่มที่ถูกตัดออกพร้อมเหตุผล)
│  │  └─ hash-password.ts  # สร้าง APP_PASSWORD_HASH จากรหัสที่พิมพ์ใน terminal
│  └─ .env.example
├─ web/
│  └─ src/
├─ data/                # (gitignore) index.json + thumbs/
├─ Dockerfile
└─ README.md
```

---

## 4. หมวด (Categories)

### 4.1 เลือกแชทคลังอัตโนมัติ (Vault discovery)
ระบบ **ค้นหาแชทคลังเอง** ไม่ต้องใส่ chat id ใน env แชทจะถูก index **ก็ต่อเมื่อครบทุกข้อ**:

1. เป็น **กลุ่ม** คือ basic group (`Chat`) หรือ supergroup (`Channel` ที่ `megagroup === true`)
   → **ไม่รวม** broadcast channel, แชทส่วนตัว, bot
2. เป็น **private** คือไม่มี public username (`username` ว่าง และ `usernames` ไม่มีตัวที่ `active`)
   → basic group ถือเป็น private เสมอ
3. **ชื่อกลุ่มขึ้นต้นด้วย `TBackup`** (ตรงตัว case-sensitive หลัง trim) ค่ากำหนดได้ที่ `VAULT_TITLE_PREFIX`
4. บัญชีเรายังเป็นสมาชิกอยู่ (ไม่ใช่ `left` / `kicked` / `deactivated`)

**ห้ามอ่าน เขียน หรือกด reaction ในแชทที่ไม่ผ่านเงื่อนไขนี้** ทุกจุดที่แตะ Telegram ต้องเช็กผ่านฟังก์ชันกลาง `isVaultChat(chatId)`

**ชื่อหมวด**: ตัด prefix และตัวคั่นต้นชื่อ (`-`, `_`, `:`, `|`, ช่องว่าง) ออก
เช่น `TBackup - งานแต่ง` → `งานแต่ง`, `TBackup_SGT` → `SGT` และถ้าตัดแล้วว่างให้ใช้ชื่อเต็ม

**การเปลี่ยนแปลงแบบ live** (ไม่ต้อง restart):
- สร้างหรือถูกเพิ่มเข้ากลุ่มใหม่ที่ผ่านเงื่อนไข → เพิ่มเข้าคลังแล้ว scan ทันที
- เปลี่ยนชื่อกลุ่ม (`MessageActionChatEditTitle` / `UpdateChannel`) → ประเมินใหม่ ถ้าไม่ผ่านแล้วให้ **เอาออกจาก index ทันที**
- กลุ่มถูกตั้ง public username → เอาออกจาก index ทันที
- ออกจากกลุ่มหรือกลุ่มถูกลบ → เอาออกจาก index
- basic group ถูกอัปเกรดเป็น supergroup (`MessageActionChatMigrateTo`) ซึ่งจะเกิดตอนเปิด Topics หรือไปตั้งค่าบางอย่าง
  → chat id เปลี่ยน ให้ย้ายไปใช้ id ใหม่แล้ว rescan
- nightly rescan (ข้อ 7.3) จะไล่ `iterDialogs()` ใหม่ทั้งหมดเพื่อเก็บตกสิ่งที่หลุดไป

### 4.2 หมวดภายในกลุ่ม

| ชนิดกลุ่ม | category คือ | id ของ category |
|---|---|---|
| กลุ่มที่ไม่เปิด Topics | ทั้งกลุ่ม | `"<chatId>"` |
| Supergroup ที่เปิด Topics (forum) | แต่ละ topic | `"<chatId>:<topicId>"` |

- forum: แสดงในเว็บเป็น **ชื่อกลุ่ม (ตัด prefix) → รายชื่อ topic** สองชั้น

- รายชื่อ topic: `channels.GetForumTopics` (ชื่อ, icon emoji, ปิด/เปิด)
- หา topic ของข้อความ: ถ้า `message.replyTo?.forumTopic` เป็นจริง → `replyTo.replyToTopId ?? replyTo.replyToMsgId` ถ้าไม่ใช่ → General topic (`1`)
- service message `MessageActionTopicCreate` / `MessageActionTopicEdit` → เพิ่มหรืออัปเดต category ทันที
- ชื่อหมวดและลำดับมาจาก Telegram ทั้งหมด ไม่มีการตั้งค่าซ้ำในระบบ

---

## 5. คำอธิบายไฟล์จาก "ข้อความถัดไป" (ใช้ในการค้นหา)

นอกจาก caption ผู้ใช้จะพิมพ์ **ข้อความ text แยกส่งตามหลังไฟล์** เพื่ออธิบายไฟล์นั้น

### กฎการผูกข้อความเข้ากับไฟล์
1. ข้อความที่เป็น **text ล้วน** (ไม่มี media และไม่ใช่ service message)
2. จะถูกผูกกับ **item ที่มี media ตัวล่าสุดก่อนหน้า** ใน **แชทและ topic เดียวกัน**
   (ถ้าเป็นอัลบั้ม ให้ผูกกับทั้งอัลบั้ม)
3. ถ้ามีข้อความ text **หลายข้อความต่อกัน** ให้ต่อรวมกันทั้งหมด (คั่นด้วยบรรทัดใหม่) จนกว่าจะเจอ media ตัวถัดไป
4. ถ้า text อยู่ **ก่อน media ตัวแรก** ของแชทหรือ topic นั้น ให้ข้ามไป ไม่ผูกกับอะไร
5. **ตั้งค่าได้**: `DESCRIPTION_WINDOW_MIN` (ค่าเริ่มต้น `0` = ไม่จำกัดเวลา)
   ถ้า > 0 จะผูกเฉพาะ text ที่ส่งห่างจาก media ไม่เกิน N นาที
6. ข้อความที่ขึ้นต้นด้วย `//` ถือเป็นโน้ต ไม่ผูกกับไฟล์ไหน (escape hatch)

### ตัวอย่าง
```
[วิดีโอ A]
"ซ้อมเพลง Heal the World รอบ 2"      → คำอธิบายของ A
"#ดนตรี #ซ้อม"                        → ต่อท้ายคำอธิบายของ A (+ tags)
[อัลบั้มภาพ B: 8 รูป]
"งานกีฬาสี เขต 11"                     → คำอธิบายของอัลบั้ม B
// โน้ต: เดี๋ยวอัปเพิ่ม                   → ไม่ผูก
[PDF C]                               → ไม่มีคำอธิบาย ใช้ชื่อไฟล์
```

### การอัปเดต
- แก้ข้อความ text → คำอธิบายของ item ที่ผูกอยู่อัปเดตตาม
- ลบข้อความ text → เอาส่วนนั้นออกจากคำอธิบาย
- ลบ media → text ที่เคยผูกกับมันจะไม่ผูกกับใคร (**ห้าม** ย้ายไปผูกกับ media ตัวก่อนหน้า)
- implement ด้วยการเก็บลำดับข้อความต่อ (chat, topic) แบบเบา ๆ (id, kind, date) แล้วคำนวณการผูกใหม่เฉพาะช่วงที่เปลี่ยน

---

## 6. Favorite = Reaction ใน Telegram

- **favorite** = ข้อความ media นั้น **เรา** กด reaction เป็น `FAVORITE_EMOJI` (ค่าเริ่มต้น `❤️`)
- ใช้ได้กับทุกชนิดไฟล์ ไม่ใช่แค่วิดีโอ สำหรับอัลบั้ม ให้ใช้ **ข้อความแรกของอัลบั้ม** เป็นตัวแทน

### อ่านสถานะ
- `message.reactions?.results` → หา `ReactionCount` ที่ `reaction` เป็น `ReactionEmoji` ตรงกับ `FAVORITE_EMOJI` และ **`chosenOrder != null`** (แปลว่าเรากดเอง)

### กดหรือยกเลิกจากเว็บ
- `messages.SendReaction({ peer, msgId, reaction: [...] })`
- **ต้องเก็บ reaction อื่นที่เรากดไว้แล้ว** ก่อนส่งให้อ่าน reaction ที่เราเลือกอยู่เดิม
  - favorite = true → ส่ง reaction เดิม + `FAVORITE_EMOJI`
  - favorite = false → ส่ง reaction เดิมโดยตัด `FAVORITE_EMOJI` ออก (ส่ง array ว่างถ้าไม่เหลือ)
- บัญชีไม่ใช่ Premium กดได้ทีละ 1 reaction ถ้า Telegram ตอบ error เรื่องจำนวน reaction ให้ส่งแค่ `FAVORITE_EMOJI` อย่างเดียว
- ถ้าแชทไม่อนุญาต emoji นี้ (`REACTION_INVALID`) ให้ตอบ error ที่อ่านเข้าใจได้
  และระบุใน README ว่าต้องเปิด reaction ❤️ ในตั้งค่าแชท (สำหรับ channel: Channel Settings → Reactions)
- อัปเดต index ทันทีหลังสำเร็จ (optimistic UI ฝั่ง web แต่ rollback ถ้า error)

### Sync จากแอป Telegram
- ฟัง raw update `UpdateMessageReactions` (และ `UpdateEditMessage` / `UpdateEditChannelMessage`) → อัปเดต favorite ใน index
- reaction ที่เปลี่ยนตอน server ปิดอยู่ จะถูกเก็บตกโดย full rescan (ข้อ 7.3)

---

## 7. Index (ในหน่วยความจำ)

### 7.1 โครงสร้างข้อมูล
```ts
type ItemType = 'video' | 'pdf' | 'image' | 'album' | 'file';

interface Item {
  id: string;            // "<chatId>_<messageId>" (อัลบั้มใช้ messageId แรก)
  categoryId: string;
  chatId: string;
  messageIds: number[];  // อัลบั้มมีหลายอัน, อื่น ๆ มีอันเดียว
  type: ItemType;
  albumItems?: { messageId: number; type: 'image' | 'video' }[];
  title: string;         // บรรทัดแรกของ caption/คำอธิบาย ที่ตัด hashtag แล้ว → หรือชื่อไฟล์
  caption: string;
  description: string;   // จาก "ข้อความถัดไป" (ข้อ 5)
  tags: string[];        // hashtag จาก caption + description, lower-case, ไม่มี '#'
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  favorite: boolean;
  postedAt: string;      // ISO
  searchText: string;    // normalize แล้ว ใช้ค้นหา
}
```

### 7.2 แยกประเภทไฟล์
| เงื่อนไข | type |
|---|---|
| มี `groupedId` → รวมทุกข้อความในกลุ่ม | `album` |
| `MessageMediaPhoto` | `image` |
| Document ที่ mime `video/*` หรือมี `DocumentAttributeVideo` | `video` |
| Document ที่ mime `application/pdf` | `pdf` |
| Document ที่ mime `image/*` | `image` |
| Document อื่น ๆ | `file` |

### 7.3 การสร้างและรักษา index
- **ตอนเริ่ม**: โหลด `data/index.json` (ถ้ามี) → พร้อมให้บริการทันที → แล้ว **catch-up** ดึงข้อความที่ใหม่กว่า id ล่าสุดของแต่ละแชท
- **ไม่มี snapshot**: full scan ด้วย `iterMessages(chat, { reverse: true })`
- **Live**: `NewMessage`, `EditedMessage`, `DeletedMessage`, `UpdateMessageReactions`, topic service messages
- **Full rescan ทุกคืน** (`RESCAN_CRON`, ค่าเริ่มต้นตี 4) เพื่อเก็บตก reaction และการลบที่หลุดไป ถ้าเสร็จแล้วให้สลับ index ใหม่แบบ atomic
- **Snapshot**: เขียน `data/index.json` แบบ debounce (เช่น 10 วินาทีหลังมีการเปลี่ยน) ผ่าน temp file + rename
- ห่อทุก Telegram call ด้วย helper จับ `FloodWaitError` → รอ `seconds + 1` แล้ว retry และ scan ให้หน่วงระหว่าง batch

### 7.4 Thumbnail
- ดึงตอนมีคนขอครั้งแรก (lazy) ด้วย `client.downloadMedia(msg, { thumb })` ใช้ขนาดกลาง
- cache ที่ `data/thumbs/<chatId>_<messageId>.jpg`
- PDF / ไฟล์ที่ไม่มี thumb → `404` แล้วให้ frontend แสดงไอคอนแทน

---

## 8. การค้นหา

ค้นหาใน index ในหน่วยความจำ (ไม่เรียก Telegram)

- `searchText` = รวม `title`, `caption`, `description`, `fileName`, `tags` → lower-case → **Unicode NFC** → ยุบช่องว่างซ้ำ
- query แยกด้วยช่องว่าง → **ทุกคำต้องเจอ (AND)** แบบ substring
  (ภาษาไทยไม่เว้นวรรคระหว่างคำ substring จึงใช้ได้ดีกว่า tokenizer)
- คำที่ขึ้นต้นด้วย `#` → กรองจาก `tags` แบบตรงตัว
- ตัวกรองรวมได้: category, type, favorite, tag, query
- เรียงผล: `postedAt` ใหม่ → เก่า (ค่าเริ่มต้น) หรือเก่า → ใหม่
- regex hashtag: `/#[\p{L}\p{M}\p{N}_]+/gu` (ต้องมี `\p{M}` เพื่อรองรับสระและวรรณยุกต์ไทย)

---

## 9. HTTP API

ทุก route ภายใต้ `/api` ยกเว้น `/api/login` ต้องมี session cookie ที่ถูกต้อง ถ้าไม่มีให้ตอบ `401`

| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/api/login` | `{ password }` → ตรวจกับ hash ที่หลังบ้าน → ตั้ง cookie `tgv_session` (ดูข้อ 9.2) |
| POST | `/api/logout` | ลบ cookie |
| GET | `/api/me` | `{ ok: true }` ถ้า login แล้ว |
| GET | `/api/categories` | รายการหมวด + จำนวน item + จำนวน favorite |
| GET | `/api/items` | query: `category`, `type`, `q`, `tag`, `fav=1`, `sort`, `cursor`, `limit` (≤ 60) → `{ items, nextCursor }` |
| GET | `/api/items/:id` | รายละเอียด item (รวม `albumItems`) |
| PUT | `/api/items/:id/favorite` | `{ favorite: boolean }` → กด/ยกเลิก reaction ใน Telegram → คืน item ล่าสุด |
| GET | `/api/tags` | query: `category` → `[{ tag, count }]` |
| GET | `/api/thumb/:chatId/:messageId` | thumbnail (cache บนดิสก์) |
| GET | `/api/file/:chatId/:messageId` | สตรีมไฟล์ รองรับ Range |
| GET | `/health` | สถานะ server, การเชื่อมต่อ Telegram, จำนวน item, เวลา scan ล่าสุด |
| GET | `/*` | static ของ web (SPA fallback → `index.html`) |

- ตรวจทุกครั้งว่า `isVaultChat(chatId)` เป็นจริง และ message นั้นอยู่ใน index ก่อนจะยอมสตรีมไฟล์หรือกด reaction

### 9.2 รหัสผ่านและ session ถาวร

**รหัสผ่าน (static ที่หลังบ้าน)**
- เก็บใน `.env` ของ server เป็น **hash** (`APP_PASSWORD_HASH`) **ห้ามเก็บรหัสจริงในโค้ด, ใน repo, ใน web bundle, หรือใน log**
- สร้าง hash ด้วย `npm run hash-password` → พิมพ์รหัสแบบซ่อนตัวอักษร → ได้ string รูปแบบ `scrypt$<salt-b64>$<hash-b64>` ไว้ copy ไปใส่ `.env`
- ใช้ `crypto.scrypt` (N=2^15, r=8, p=1, keylen 64) และเทียบด้วย `crypto.timingSafeEqual`
- server ต้อง **ไม่ยอม start** ถ้าไม่มี `APP_PASSWORD_HASH` หรือ `SESSION_SECRET`
- กัน brute force: จำกัด 5 ครั้ง/นาที/IP และถ้าผิดเกิน 20 ครั้ง/ชั่วโมง/IP ให้ล็อก IP นั้น 1 ชั่วโมง

**Session ถาวร (login ครั้งเดียวในเครื่องนั้น)**
- token = `base64url(payload).HMAC-SHA256(SESSION_SECRET)` โดย payload = `{ sid, v: SESSION_VERSION, iat }` และ **ไม่มีวันหมดอายุในตัว token**
- cookie `tgv_session`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000` (400 วัน)
- **เบราว์เซอร์อย่าง Chrome จำกัดอายุ cookie ไว้ไม่เกิน 400 วัน** จึงต้องทำแบบ **sliding**:
  ทุก request ที่ผ่าน auth ให้ **ส่ง cookie เดิมกลับไปพร้อม Max-Age 400 วันใหม่** (ทำไม่เกินวันละครั้งต่อ session ก็พอ)
  → ถ้าเปิดเว็บอย่างน้อยปีละครั้ง จะไม่ต้อง login ใหม่เลย
- **ไม่มีปุ่ม logout ใน UI** แต่ยังมี `/api/logout` ไว้ใช้ตอนจำเป็น
- **ทางออกฉุกเฉิน**: ถ้าเครื่องหายหรือสงสัยว่ารหัสหลุด ให้เพิ่มค่า `SESSION_VERSION` ใน `.env` แล้ว restart
  → ทุก session เดิมใช้ไม่ได้ทันที (และควรเปลี่ยนรหัสด้วย)

**Gate ทั้งเว็บ**
- ถ้าเข้า `/` หรือหน้าใดก็ตามโดยยังไม่มี session ให้ **แสดงแค่หน้าใส่รหัส** โดยไม่โหลดข้อมูลหรือรายชื่อหมวดใด ๆ
- static asset ของ web (JS/CSS) โหลดได้โดยไม่ต้อง login แต่ **ห้ามมีข้อมูลจาก Telegram ฝังอยู่ใน bundle**
- `/api/thumb/*` และ `/api/file/*` ต้องผ่าน session เช่นเดียวกับ API อื่น

### 9.1 การสตรีมด้วย Range (สำคัญที่สุด)
1. `client.getMessages(chat, { ids: [messageId] })` เพื่อได้ file reference ใหม่
   (file reference หมดอายุได้ ห้ามเก็บถาวร) แล้ว cache message object ใน LRU ราว 30 นาที
2. parse `Range: bytes=start-end`
   - ไม่มี Range → `200` + ทั้งไฟล์
   - มี Range → `206` + `Content-Range: bytes start-end/size`
   - Range ไม่ถูกต้อง → `416`
3. `client.iterDownload({ file: media, offset, requestSize: 512 * 1024 })`
   - **offset ต้องหารด้วย 4096 ลงตัว** ให้ปัด start ลงเป็น block แล้วตัด byte ส่วนเกินหัว/ท้ายออกก่อนส่ง
   - หยุดเมื่อส่งครบช่วงที่ขอ
4. Headers: `Accept-Ranges: bytes`, `Content-Type`, `Content-Length`,
   `Content-Disposition: inline; filename*=UTF-8''<encoded>`, `Cache-Control: private, max-age=3600`
5. client ปิดการเชื่อมต่อ (`request.raw.on('close')`) → หยุด iterDownload ทันที
6. จำกัดการดาวน์โหลดพร้อมกันไม่เกิน `MAX_CONCURRENT_DOWNLOADS` (ค่าเริ่มต้น 4) เพื่อเลี่ยง FloodWait

---

## 10. Web App

**Mobile-first** (ส่วนใหญ่เปิดจากมือถือ) รองรับภาษาไทยเต็มรูปแบบ

1. **หน้าใส่รหัส (gate)**: ช่องรหัสผ่านช่องเดียว + ปุ่มเข้า ตอนเปิดแอปให้เรียก `/api/me` ก่อน
   ถ้าได้ `401` ให้แสดงหน้านี้อย่างเดียว ถ้ารหัสผิดให้แสดงข้อความ และถ้าโดน rate limit ให้แสดงว่ารอกี่วินาที
   เข้าได้แล้วจะไม่เห็นหน้านี้อีกในเครื่องนั้น
2. **Home**:
   - grid หมวด (emoji ของ topic + ชื่อ + จำนวนไฟล์)
   - ทางลัด **"⭐ Favorites ทั้งหมด"** รวมทุกหมวด
   - **ช่องค้นหาข้ามทุกหมวด** ด้านบน
3. **Category view**:
   - ช่องค้นหา (debounce 300ms) + chips ตัวกรอง: ทั้งหมด / วิดีโอ / PDF / ภาพ / ⭐
   - แถบ tag ที่กดกรองได้ (จาก `/api/tags`)
   - grid การ์ด: thumbnail, ชื่อ, ความยาววิดีโอหรือจำนวนภาพในอัลบั้ม, **ปุ่ม ❤️ บนการ์ด**
   - ไฮไลต์คำที่ค้นในชื่อหรือคำอธิบาย
   - infinite scroll ด้วย cursor
4. **Viewers** (เปิดเป็นหน้าเต็ม มีปุ่ม ❤️ และแสดงคำอธิบายเต็มใต้ไฟล์):
   - วิดีโอ: `<video controls preload="metadata" playsInline src="/api/file/...">`
   - PDF: `pdfjs-dist` (เปิด range request ไม่ต้องโหลดทั้งไฟล์) มีปุ่มเปิดในแท็บใหม่ด้วย
   - อัลบั้ม: lightbox ปัดซ้ายขวาได้ แสดงตำแหน่ง (3/8) และโหลดภาพถัดไปไว้ล่วงหน้า
5. **ปุ่ม Favorite**: optimistic toggle → `PUT /api/items/:id/favorite` → rollback และแสดง toast ถ้า error
6. จำ state ของตัวกรองและตำแหน่ง scroll เมื่อกดกลับจาก viewer

---

## 11. Environment Variables

```
# Telegram (จาก https://my.telegram.org)
TG_API_ID=
TG_API_HASH=
TG_SESSION=                 # จาก npm run login — เทียบเท่ารหัสผ่านบัญชี!
VAULT_TITLE_PREFIX=TBackup  # index เฉพาะกลุ่ม private ที่ชื่อขึ้นต้นด้วยคำนี้

# Features
FAVORITE_EMOJI=❤️
DESCRIPTION_WINDOW_MIN=0     # 0 = ไม่จำกัดเวลา
RESCAN_CRON=0 4 * * *
MAX_CONCURRENT_DOWNLOADS=4
DATA_DIR=./data

# Web / Auth
PORT=8080
APP_PASSWORD_HASH=          # จาก npm run hash-password (ห้ามใส่รหัสจริง)
SESSION_SECRET=             # random 32+ bytes (เปลี่ยนแล้ว session ทั้งหมดหลุด)
SESSION_VERSION=1           # เพิ่มเลขเพื่อเตะทุกเครื่องออก
```

---

## 12. Security Checklist

- [ ] `TG_SESSION` อยู่ใน server เท่านั้น **ห้าม commit, ห้าม log, ห้ามส่งไป frontend**
- [ ] `.env` และ `data/` อยู่ใน `.gitignore` มีแค่ `.env.example`
- [ ] อ่านและเขียน (reaction) **เฉพาะกลุ่ม private ที่ขึ้นต้นด้วย `TBackup`** ผ่าน `isVaultChat()` เท่านั้น
- [ ] รหัสผ่านเก็บเป็น scrypt hash ใน `.env` ฝั่ง server เท่านั้น ไม่อยู่ในโค้ด, repo, web bundle หรือ log
- [ ] ทุก `/api/*` ต้องผ่าน session cookie และ login มี rate limit กับ lockout
- [ ] มีทางเตะทุก session ออกด้วย `SESSION_VERSION`
- [ ] ใช้ HTTPS เสมอเมื่อ deploy (cookie ตั้ง `Secure`)
- [ ] ระบบเป็น private เท่านั้น ห้ามเปิด public (เสี่ยงผิด ToS ของ Telegram และโดนแบนบัญชี)
- [ ] (ทำเองในแอป) เพิ่มบัญชีสำรองเป็นแอดมินทุกแชทคลัง และเปิด reaction ❤️ ในแชทคลัง

---

## 13. Milestones

ทำทีละขั้น เมื่อจบแต่ละขั้นให้สรุปสิ่งที่ทำและวิธีทดสอบ

- [ ] **M0 Setup**: monorepo, TypeScript, ESLint/Prettier, `.env.example`, README
- [ ] **M1 Telegram**: `npm run login` → ได้ session string, `npm run whoami`,
  `npm run list-chats` แสดงกลุ่มที่ผ่านเงื่อนไข TBackup และกลุ่มที่เกือบผ่านพร้อมเหตุผล (เช่น "เป็น channel", "เป็น public")
  - unit test ของ `isVaultChat` / การตัด prefix เป็นชื่อหมวด ครบทุกกรณีในข้อ 4.1
- [ ] **M2 Index**: scan แชทคลัง → หมวด / ประเภท / อัลบั้ม / tags / **คำอธิบายจากข้อความถัดไป** / **favorite** + snapshot JSON
  - มี unit test สำหรับกฎผูกคำอธิบาย (ข้อ 5) ครบทุกกรณีในตัวอย่าง
  - มี unit test สำหรับการค้นหาภาษาไทยและ hashtag ภาษาไทย
- [ ] **M3 Live updates**: ไฟล์ใหม่ / ข้อความอธิบาย / แก้ / ลบ / กด ❤️ ในแอป / สร้าง topic ใหม่ → index อัปเดตภายในไม่กี่วินาที + nightly rescan
- [ ] **M4 API**: `hash-password`, auth gate + session ถาวรแบบ sliding, items/search/tags, favorite toggle, thumbnail, **สตรีมแบบ Range**
  - ทดสอบว่าไม่มี cookie แล้วทุก `/api/*` ได้ `401` และเพิ่ม `SESSION_VERSION` แล้ว cookie เดิมใช้ไม่ได้
  - ทดสอบ `curl -H "Range: bytes=0-1023"` ได้ `206` และ offset ที่ไม่ลงตัว 4096 ได้ byte ถูกต้อง
- [ ] **M5 Web**: login → หมวด → ค้นหา/กรอง → เล่นวิดีโอ (กดข้ามช่วงได้) / เปิด PDF / ดูอัลบั้ม / กด ❤️ บนมือถือ
- [ ] **M6 Deploy**: Dockerfile (multi-stage: build web → copy เข้า server), volume สำหรับ `data/`, health check, auto-restart

### Definition of Done (เฟสแรก)
0. เปิดเว็บครั้งแรก → เห็นแค่หน้าใส่รหัส → ใส่รหัสถูก → เข้าได้ → ปิดเบราว์เซอร์แล้วเปิดใหม่ก็ยังเข้าได้โดยไม่ถามรหัส
   สร้างกลุ่ม private ชื่อ `TBackup - ทดสอบ` → ขึ้นเป็นหมวดใหม่ในเว็บโดยไม่ต้อง restart
   เปลี่ยนชื่อเป็น `ทดสอบ` (ไม่มี prefix) → หายจากเว็บ
1. สร้าง topic ใหม่ ส่งวิดีโอ 1 GB ตามด้วยข้อความ "ซ้อมดนตรี #ซ้อม" แล้วส่ง PDF และอัลบั้มภาพ 10 รูป
2. ภายใน 1 นาที ทั้งหมดขึ้นในเว็บถูกหมวด และพิมพ์ค้นคำว่า "ซ้อม" เจอวิดีโอนั้น
3. วิดีโอกดข้ามช่วงบนมือถือได้ลื่น
4. กด ❤️ ในเว็บ → reaction ขึ้นในแอป Telegram และกดยกเลิกในแอป → เว็บอัปเดตตาม
5. restart server แล้วข้อมูลกลับมาครบทันทีจาก snapshot ลบ `data/` แล้ว restart ก็ต้อง scan กลับมาได้ครบ
