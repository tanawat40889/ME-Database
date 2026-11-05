export type ItemType = 'video' | 'pdf' | 'image' | 'album' | 'file';
export type MediaType = 'image' | 'video' | 'pdf' | 'file';

export interface Item {
  id: string;
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
  postedAt: string;
}

export interface Category {
  id: string;
  chatId: string;
  topicId: number | null;
  name: string;
  groupName: string | null;
  emoji?: string;
  closed?: boolean;
  order: number;
  count: number;
  favorites: number;
}

export interface ItemsPage {
  items: Item[];
  nextCursor: string | null;
}

export interface TagCount {
  tag: string;
  count: number;
}
