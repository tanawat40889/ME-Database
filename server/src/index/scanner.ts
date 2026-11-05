import { Api, type TelegramClient } from 'telegram';
import { config } from '../config.js';
import { toChatInfo } from '../telegram/client.js';
import { toRaw } from '../telegram/messages.js';
import { tg } from '../telegram/retry.js';
import {
  categoryName,
  registerChat,
  removeChat as removeVaultChat,
  vaultChats,
  type ChatInfo,
} from '../telegram/vault.js';
import { planReconcile } from './reconcile.js';
import { IndexStore } from './store.js';
import { categoryId, type Category, type RawMsg } from './types.js';

export interface VaultEntry {
  info: ChatInfo;
  entity: Api.Chat | Api.Channel;
}

const BATCH = 500;

/** Walk all dialogs; keep only chats passing isVaultChat rules. */
export async function discoverVault(client: TelegramClient): Promise<VaultEntry[]> {
  const out: VaultEntry[] = [];
  const dialogs = await tg(() => client.getDialogs({ limit: undefined }));
  for (const d of dialogs) {
    const info = toChatInfo(d.entity);
    if (!info || !registerChat(info, config.prefix).ok) continue;
    if (d.entity instanceof Api.Chat || d.entity instanceof Api.Channel) {
      out.push({ info, entity: d.entity });
    }
  }
  // swap the registry only now, so isVaultChat() never goes empty while live events arrive
  const keep = new Set(out.map((v) => v.info.id));
  for (const c of vaultChats()) if (!keep.has(c.id)) removeVaultChat(c.id);
  return out;
}

/** custom emoji document ids → emoji characters (best effort, icons are cosmetic) */
export async function customEmoji(
  client: TelegramClient,
  ids: Api.long[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const docs = await tg(() =>
      client.invoke(new Api.messages.GetCustomEmojiDocuments({ documentId: ids })),
    );
    for (const d of docs) {
      if (!(d instanceof Api.Document)) continue;
      const a = d.attributes.find((x) => x instanceof Api.DocumentAttributeCustomEmoji);
      if (a) out.set(String(d.id), a.alt);
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function fetchTopics(client: TelegramClient, e: VaultEntry): Promise<Category[]> {
  const topics: Api.ForumTopic[] = [];
  let offsetDate = 0;
  let offsetId = 0;
  let offsetTopic = 0;
  for (;;) {
    const res = await tg(() =>
      client.invoke(
        new Api.channels.GetForumTopics({
          channel: e.entity,
          offsetDate,
          offsetId,
          offsetTopic,
          limit: 100,
        }),
      ),
    );
    const page = res.topics.filter((t): t is Api.ForumTopic => t instanceof Api.ForumTopic);
    topics.push(...page);
    const last = page[page.length - 1];
    if (res.topics.length < 100 || !last) break;
    const top = res.messages.find((m) => m.id === last.topMessage);
    offsetDate = top && 'date' in top ? top.date : 0;
    offsetId = last.topMessage;
    offsetTopic = last.id;
  }

  const emoji = await customEmoji(
    client,
    topics.flatMap((t) => (t.iconEmojiId ? [t.iconEmojiId] : [])),
  );

  const group = categoryName(e.info.title, config.prefix);
  return topics.map((t, i) => ({
    id: categoryId(e.info.id, t.id),
    chatId: e.info.id,
    topicId: t.id,
    name: t.title,
    groupName: group,
    emoji: t.iconEmojiId ? emoji.get(String(t.iconEmojiId)) : undefined,
    closed: !!t.closed,
    order: i,
  }));
}

/** Scan one vault chat into `store`. Resumes after store.lastId(chat) unless the store is fresh. */
export async function scanChat(
  client: TelegramClient,
  store: IndexStore,
  e: VaultEntry,
  log: (s: string) => void = () => {},
): Promise<void> {
  const { info } = e;
  store.setChat({
    id: info.id,
    title: info.title,
    forum: info.forum,
    lastId: store.lastId(info.id),
  });

  if (info.forum) {
    for (const c of await fetchTopics(client, e)) store.setCategory(c);
  } else {
    store.setCategory({
      id: info.id,
      chatId: info.id,
      topicId: null,
      name: categoryName(info.title, config.prefix),
      groupName: null,
      order: 0,
    });
  }

  const touched = new Set<string>();
  let cursor = store.lastId(info.id);
  let n = 0;
  let batch: RawMsg[] = [];

  const flush = () => {
    for (const m of batch) {
      const cid = categoryId(m.chatId, m.topicId);
      if (!store.categories.has(cid)) {
        store.setCategory({
          id: cid,
          chatId: m.chatId,
          topicId: m.topicId,
          name: m.topicId === 1 ? 'General' : `Topic ${m.topicId}`,
          groupName: categoryName(info.title, config.prefix),
          order: 9999,
        });
      }
    }
    for (const c of store.upsert(batch)) touched.add(c);
    batch = [];
  };

  // tg() retries on FloodWait; `cursor` makes each retry resume where it stopped
  await tg(async () => {
    for await (const m of client.iterMessages(e.entity, {
      reverse: true,
      minId: cursor,
      limit: undefined,
      waitTime: 1,
    })) {
      cursor = m.id;
      n++;
      const raw = toRaw(m, info.id, info.forum, config.favEmoji);
      if (raw) batch.push(raw);
      if (batch.length >= BATCH) flush();
    }
  });
  flush();

  for (const c of touched) store.rebuildCategory(c);
  const chat = store.chats.get(info.id)!;
  if (cursor > chat.lastId) chat.lastId = cursor;
  log(`${info.title}: ${n} messages scanned`);
}

/** Fresh store from scratch. Caller swaps it in atomically (e.g. nightly rescan). */
export async function fullScan(
  client: TelegramClient,
  log: (s: string) => void = () => {},
  prev?: IndexStore,
): Promise<IndexStore> {
  const store = new IndexStore(config.descWindowMin);
  for (const e of await discoverVault(client)) await scanChat(client, store, e, log);
  if (prev) {
    // deleted media cannot be seen by a rescan: keep their tombstones so text never re-binds
    for (const c of store.carryTombstones(prev, config.prefix)) store.rebuildCategory(c);
  }
  return store;
}

/** Startup catch-up on a loaded snapshot: only messages newer than the last id per chat. */
export async function catchUp(
  client: TelegramClient,
  store: IndexStore,
  log: (s: string) => void = () => {},
): Promise<void> {
  const vault = await discoverVault(client);
  const alive = new Set(vault.map((v) => v.info.id));
  for (const id of [...store.chats.keys()]) if (!alive.has(id)) store.removeChat(id);
  for (const e of vault) await scanChat(client, store, e, log);
}

/** Apply a vault rules change (rename / public / join / leave / forum toggle / migrate) without a full rescan. */
export async function reconcile(
  client: TelegramClient,
  store: IndexStore,
  log: (s: string) => void = () => {},
): Promise<void> {
  const vault = await discoverVault(client);
  const plan = planReconcile(
    store,
    vault.map((v) => v.info),
  );
  for (const id of plan.remove) {
    store.removeChat(id);
    log(`removed ${id} from index`);
  }
  for (const e of vault) {
    if (plan.scan.includes(e.info.id)) await scanChat(client, store, e, log);
  }
}
