import { Api } from 'telegram';
import type { MediaInfo, MediaType, RawMsg } from '../index/types.js';

const stripVs = (e: string) => e.replace(/️/g, '');

/** Topic of a message in a forum: replyTo.replyToTopId ?? replyToMsgId, else General (1). */
export function topicOf(
  r: { forumTopic?: boolean; replyToTopId?: number; replyToMsgId?: number } | undefined,
): number {
  return r?.forumTopic ? (r.replyToTopId ?? r.replyToMsgId ?? 1) : 1;
}

/** True when WE reacted with `emoji` (chosenOrder set). */
export function isFavorite(reactions: Api.MessageReactions | undefined, emoji: string): boolean {
  const want = stripVs(emoji);
  return !!reactions?.results.some(
    (r) =>
      r.chosenOrder != null &&
      r.reaction instanceof Api.ReactionEmoji &&
      stripVs(r.reaction.emoticon) === want,
  );
}

export function classify(mime: string | undefined, hasVideoAttr: boolean): MediaType {
  const m = (mime ?? '').toLowerCase();
  if (hasVideoAttr || m.startsWith('video/')) return 'video';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  return 'file';
}

function mediaInfo(media: Api.TypeMessageMedia | undefined): MediaInfo | null {
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    let width: number | undefined;
    let height: number | undefined;
    let size: number | undefined;
    for (const s of media.photo.sizes as unknown as { w?: number; h?: number; size?: number }[]) {
      if (typeof s.w === 'number' && (width === undefined || s.w > width)) {
        width = s.w;
        height = s.h;
        if (typeof s.size === 'number') size = s.size;
      }
    }
    return { type: 'image', mimeType: 'image/jpeg', width, height, size };
  }
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const d = media.document;
    const info: MediaInfo = {
      type: classify(
        d.mimeType,
        d.attributes.some((a) => a instanceof Api.DocumentAttributeVideo),
      ),
      mimeType: d.mimeType,
      size: d.size.toJSNumber(),
    };
    for (const a of d.attributes) {
      if (a instanceof Api.DocumentAttributeFilename) info.fileName = a.fileName;
      else if (a instanceof Api.DocumentAttributeVideo) {
        info.duration = a.duration;
        info.width = a.w;
        info.height = a.h;
      } else if (a instanceof Api.DocumentAttributeImageSize) {
        info.width ??= a.w;
        info.height ??= a.h;
      }
    }
    return info;
  }
  return null;
}

/** GramJS message → light record. null = service/empty/unsupported (ignored). */
export function toRaw(
  m: Api.TypeMessage,
  chatId: string,
  forum: boolean,
  favEmoji: string,
): RawMsg | null {
  if (!(m instanceof Api.Message)) return null;
  const media = mediaInfo(m.media);
  const text = m.message ?? '';
  if (!media && !text.trim()) return null;
  return {
    id: m.id,
    chatId,
    topicId: forum
      ? topicOf(m.replyTo instanceof Api.MessageReplyHeader ? m.replyTo : undefined)
      : null,
    date: m.date,
    kind: media ? 'media' : 'text',
    ...(m.groupedId && { groupedId: String(m.groupedId) }),
    ...(media && { media }),
    text,
    favorite: isFavorite(m.reactions, favEmoji),
  };
}
