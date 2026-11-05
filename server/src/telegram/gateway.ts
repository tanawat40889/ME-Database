import bigInt from 'big-integer';
import { Api, type TelegramClient } from 'telegram';
import { REQUEST_SIZE } from '../http/range.js';
import type { FileSource, Gateway } from '../http/types.js';
import { FavoriteError, chosenFrom, setFavoriteReaction } from './reactions.js';
import { tg } from './retry.js';
import { pickThumb } from './thumb.js';

const errCode = (e: unknown) =>
  String((e as { errorMessage?: string })?.errorMessage ?? (e as Error)?.message ?? e);

export class TgGateway implements Gateway {
  private cache = new Map<string, { msg: Api.Message; at: number }>();

  constructor(
    private client: TelegramClient,
    private favEmoji: string,
    private ttlMs = 30 * 60_000, // file references expire, never keep a message forever
    private maxCached = 500,
  ) {}

  /** Message with a fresh file reference (LRU, ~30 min). */
  private async message(
    chatId: string,
    msgId: number,
    fresh = false,
  ): Promise<Api.Message | undefined> {
    const key = `${chatId}_${msgId}`;
    const hit = this.cache.get(key);
    if (!fresh && hit && Date.now() - hit.at < this.ttlMs) {
      this.cache.delete(key); // re-insert → most recently used
      this.cache.set(key, hit);
      return hit.msg;
    }
    const [m] = await tg(() => this.client.getMessages(Number(chatId), { ids: [msgId] }));
    if (!(m instanceof Api.Message)) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.set(key, { msg: m, at: Date.now() });
    while (this.cache.size > this.maxCached) this.cache.delete(this.cache.keys().next().value!);
    return m;
  }

  private async *download(
    chatId: string,
    msgId: number,
    first: Api.Message,
    doc: Api.Document,
    offset: number,
    endExclusive: number,
  ): AsyncGenerator<Uint8Array> {
    let msg = first;
    let sent = false;
    for (let attempt = 0; ; attempt++) {
      try {
        const chunks = Math.ceil((endExclusive - offset) / REQUEST_SIZE);
        for await (const c of this.client.iterDownload({
          file: msg.media as Api.TypeMessageMedia,
          offset: bigInt(offset),
          requestSize: REQUEST_SIZE,
          limit: chunks,
          fileSize: doc.size,
        })) {
          sent = true;
          yield c;
        }
        return;
      } catch (e) {
        if (sent || attempt > 0 || !/FILE_REFERENCE/.test(errCode(e))) throw e;
        msg = (await this.message(chatId, msgId, true)) ?? msg; // expired reference: refetch once
      }
    }
  }

  async fileSource(chatId: string, msgId: number): Promise<FileSource | null> {
    const m = await this.message(chatId, msgId);
    const media = m?.media;
    if (!m || !media) return null;

    if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
      const doc = media.document;
      const name = doc.attributes.find((a) => a instanceof Api.DocumentAttributeFilename)?.fileName;
      return {
        size: doc.size.toJSNumber(),
        mime: doc.mimeType,
        name,
        align: REQUEST_SIZE,
        open: (offset, endExclusive) => this.download(chatId, msgId, m, doc, offset, endExclusive),
      };
    }

    if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
      const buf = await tg(() => this.client.downloadMedia(m));
      if (!Buffer.isBuffer(buf)) return null;
      return {
        size: buf.length,
        mime: 'image/jpeg',
        name: `photo_${msgId}.jpg`,
        align: 4096,
        async *open(offset) {
          yield buf.subarray(offset);
        },
      };
    }
    return null;
  }

  async thumb(chatId: string, msgId: number): Promise<Buffer | null> {
    const m = await this.message(chatId, msgId);
    const media = m?.media;
    let sizes: readonly Api.TypePhotoSize[] | undefined;
    if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo)
      sizes = media.photo.sizes;
    else if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
      sizes = media.document.thumbs;
    }
    const pick = pickThumb(sizes);
    if (!m || !pick) return null;
    const out = await tg(() => this.client.downloadMedia(m, { thumb: pick }));
    return Buffer.isBuffer(out) ? out : null;
  }

  async setFavorite(chatId: string, msgId: number, favorite: boolean): Promise<void> {
    const peer = await this.client.getInputEntity(Number(chatId));
    await setFavoriteReaction(
      {
        chosen: async () => {
          const m = await this.message(chatId, msgId, true);
          if (!m) throw new FavoriteError('not_found', 'message not found in Telegram');
          return chosenFrom(m.reactions);
        },
        send: async (reaction) => {
          await tg(() =>
            this.client.invoke(new Api.messages.SendReaction({ peer, msgId, reaction })),
          );
        },
      },
      this.favEmoji,
      favorite,
    );
  }
}
