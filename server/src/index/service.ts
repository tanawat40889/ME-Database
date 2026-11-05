import { join } from 'node:path';
import bigInt from 'big-integer';
import cron from 'node-cron';
import type { TelegramClient } from 'telegram';
import { Raw } from 'telegram/events/Raw.js';
import { config } from '../config.js';
import { tg } from '../telegram/retry.js';
import { translateUpdate } from '../telegram/updates.js';
import { isVaultChat } from '../telegram/vault.js';
import { LiveIndex, replay, type LiveEvent } from './live.js';
import { catchUp, customEmoji, fullScan, reconcile } from './scanner.js';
import { Debounced, loadSnapshot, saveSnapshot } from './snapshot.js';
import { IndexStore } from './store.js';

const SNAPSHOT_DEBOUNCE_MS = 10_000;
const RECONCILE_DEBOUNCE_MS = 3_000;

const stamp = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);

/** Owns the index: snapshot load, catch-up, live updates, reconcile, nightly rescan. */
export class IndexService {
  store = new IndexStore(config.descWindowMin);
  ready = false;
  lastScanAt: string | null = null;
  lastScanMs: number | null = null;

  private selfId = '';
  private rescanning = false;
  private reconRunning = false;
  private reconTimer: NodeJS.Timeout | null = null;
  private task: { stop(): void } | null = null;
  private readonly file = join(config.dataDir, 'index.json');
  private readonly snap = new Debounced(
    () => saveSnapshot(this.file, this.store.toSnapshot()),
    SNAPSHOT_DEBOUNCE_MS,
  );
  private readonly live = new LiveIndex(
    () => this.store,
    config.prefix,
    () => this.snap.trigger(),
  );

  constructor(
    private client: TelegramClient,
    private log: (s: string) => void = stamp,
    private verbose = false,
  ) {}

  status() {
    return {
      ready: this.ready,
      connected: !!this.client.connected,
      items: this.store.allItems().length,
      chats: this.store.chats.size,
      lastScanAt: this.lastScanAt,
      lastScanMs: this.lastScanMs,
    };
  }

  async start(): Promise<void> {
    await this.client.connect();
    const me = await tg(() => this.client.getMe());
    this.selfId = String(me.id);
    this.client.addEventHandler((u: unknown) => void this.onUpdate(u), new Raw({}));

    const snap = await loadSnapshot(this.file);
    if (snap) {
      this.store = IndexStore.fromSnapshot(snap, config.descWindowMin);
      this.ready = true; // serve the snapshot right away
      this.log(`snapshot loaded: ${this.store.allItems().length} items, catching up`);
      const t0 = Date.now();
      await catchUp(this.client, this.store, this.log);
      this.live.flush();
      this.markScanned(Date.now() - t0);
    } else {
      this.log('no snapshot: full scan');
      await this.rescan();
    }

    if (cron.validate(config.rescanCron)) {
      this.task = cron.schedule(config.rescanCron, () => {
        this.rescan().catch((e) => this.log(`rescan failed: ${errMsg(e)}`));
      });
    } else this.log(`invalid RESCAN_CRON "${config.rescanCron}": nightly rescan disabled`);
    this.log(`ready: ${JSON.stringify(this.status())}`);
  }

  async stop(): Promise<void> {
    this.task?.stop();
    if (this.reconTimer) clearTimeout(this.reconTimer);
    this.live.flush();
    await this.snap.flush();
    await this.client.destroy();
  }

  /** Full rescan into a fresh store, then swap. Events that arrive meanwhile are replayed onto it. */
  async rescan(): Promise<void> {
    if (this.rescanning) return;
    this.rescanning = true;
    this.live.startBuffering();
    const t0 = Date.now();
    try {
      const next = await fullScan(this.client, this.log, this.store);
      replay(next, this.live.stopBuffering(), config.prefix); // same tick as the swap: nothing slips between
      this.store = next;
      this.ready = true;
      this.markScanned(Date.now() - t0);
      await this.snap.flush();
      this.log(`rescan done: ${next.allItems().length} items in ${Date.now() - t0}ms`);
    } finally {
      this.live.stopBuffering();
      this.rescanning = false;
    }
  }

  /** apply an event and rebuild right away (used after a favorite toggle from the web) */
  applyNow(ev: LiveEvent): void {
    this.live.apply(ev);
    this.live.flush();
  }

  private markScanned(ms: number): void {
    this.lastScanAt = new Date().toISOString();
    this.lastScanMs = ms;
  }

  private async onUpdate(u: unknown): Promise<void> {
    try {
      const ctx = {
        isVault: isVaultChat,
        forum: (id: string) => this.store.chats.get(id)?.forum ?? false,
        favEmoji: config.favEmoji,
        selfId: this.selfId,
      };
      for (const ev of translateUpdate(u, ctx)) await this.handle(ev);
    } catch (e) {
      this.log(`update error: ${errMsg(e)}`);
    }
  }

  private async handle(ev: LiveEvent): Promise<void> {
    if (ev.t === 'reconcile') return this.scheduleReconcile();
    if (ev.t === 'topic' && ev.iconEmojiId) {
      const emoji = (await customEmoji(this.client, [bigInt(ev.iconEmojiId)])).get(ev.iconEmojiId);
      ev = { ...ev, emoji };
    }
    if (this.verbose) this.log(`live ${ev.t} ${describe(ev)}`);
    this.live.apply(ev);
  }

  private scheduleReconcile(): void {
    if (this.reconTimer) clearTimeout(this.reconTimer);
    this.reconTimer = setTimeout(() => void this.runReconcile(), RECONCILE_DEBOUNCE_MS);
  }

  private async runReconcile(): Promise<void> {
    this.reconTimer = null;
    if (this.rescanning) return; // the rescan sees the new state anyway
    if (this.reconRunning) return this.scheduleReconcile();
    this.reconRunning = true;
    try {
      this.log('reconcile: vault rules may have changed');
      await reconcile(this.client, this.store, this.log);
      this.live.flush();
    } catch (e) {
      this.log(`reconcile failed: ${errMsg(e)}`);
    } finally {
      this.reconRunning = false;
    }
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function describe(ev: LiveEvent): string {
  switch (ev.t) {
    case 'msg':
      return `${ev.msg.chatId}:${ev.msg.id} ${ev.msg.kind}`;
    case 'delete':
      return `${ev.chatId ?? '(basic group)'} ids=${ev.ids.join(',')}`;
    case 'reaction':
      return `${ev.chatId}:${ev.id} favorite=${ev.favorite}`;
    case 'topic':
      return `${ev.chatId}:${ev.topicId} ${ev.create ? 'create' : 'edit'} ${ev.title ?? ''}`;
    default:
      return '';
  }
}
