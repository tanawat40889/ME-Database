import { bindDescriptions } from './describe.js';
import { buildSearchText, extractTags, makeTitle } from './text.js';
import { categoryId, type Item, type RawMsg } from './types.js';

/** Build all items of ONE category (all msgs share chat + topic). */
export function buildItems(msgs: RawMsg[], windowMin = 0): Item[] {
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const units = bindDescriptions(msgs, windowMin);
  const items: Item[] = [];

  for (const u of units) {
    const ms = u.messageIds.sort((a, b) => a - b).map((id) => byId.get(id)!);
    const first = ms[0];
    const media = first.media!;
    const captions = [...new Set(ms.map((m) => m.text.trim()).filter(Boolean))];
    const caption = captions.join('\n');
    const description = u.description;
    const tags = extractTags(caption, description);
    const title = makeTitle(caption, description, media.fileName) || '(ไม่มีชื่อ)';
    const isAlbum = u.groupedId !== undefined;

    items.push({
      id: `${first.chatId}_${first.id}`,
      categoryId: categoryId(first.chatId, first.topicId),
      chatId: first.chatId,
      messageIds: ms.map((m) => m.id),
      type: isAlbum ? 'album' : media.type,
      ...(isAlbum && {
        albumItems: ms.map((m) => ({ messageId: m.id, type: m.media!.type })),
      }),
      title,
      caption,
      description,
      tags,
      fileName: media.fileName,
      mimeType: media.mimeType,
      size: media.size,
      duration: media.duration,
      width: media.width,
      height: media.height,
      favorite: first.favorite,
      postedAt: new Date(first.date * 1000).toISOString(),
      searchText: buildSearchText([title, caption, description, media.fileName, ...tags]),
    });
  }
  return items;
}
