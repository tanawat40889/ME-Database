export type ItemType = 'video' | 'pdf' | 'image' | 'album' | 'file';
export type MediaType = 'image' | 'video' | 'pdf' | 'file';

export interface MediaInfo {
  type: MediaType;
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
}

/** Light per-message record; items are derived from these (so M3 can recompute only what changed). */
export interface RawMsg {
  id: number;
  chatId: string;
  topicId: number | null; // null = chat is not a forum
  date: number; // unix seconds
  kind: 'media' | 'text' | 'tombstone';
  groupedId?: string;
  media?: MediaInfo;
  text: string; // caption for media, body for text
  favorite: boolean;
}

export interface Item {
  id: string; // "<chatId>_<firstMessageId>"
  categoryId: string;
  chatId: string;
  messageIds: number[];
  type: ItemType;
  albumItems?: { messageId: number; type: MediaType }[];
  title: string;
  caption: string;
  description: string;
  tags: string[];
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  favorite: boolean;
  postedAt: string; // ISO
  searchText: string;
}

export interface Category {
  id: string;
  chatId: string;
  topicId: number | null;
  name: string;
  groupName: string | null; // forum: group title (prefix stripped); else null
  emoji?: string;
  closed?: boolean;
  order: number;
}

export interface ChatMeta {
  id: string;
  title: string;
  forum: boolean;
  lastId: number; // highest message id scanned
}

export const categoryId = (chatId: string, topicId: number | null): string =>
  topicId === null ? chatId : `${chatId}:${topicId}`;
