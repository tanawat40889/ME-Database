export interface FileSource {
  size: number;
  mime: string;
  name?: string;
  /** offsets passed to open() are multiples of this */
  align: number;
  /** chunks from `offset` (aligned) up to at least `endExclusive` (or EOF) */
  open(offset: number, endExclusive: number): AsyncIterable<Uint8Array>;
}

/** Everything the HTTP layer needs from Telegram (faked in tests). */
export interface Gateway {
  fileSource(chatId: string, msgId: number): Promise<FileSource | null>;
  thumb(chatId: string, msgId: number): Promise<Buffer | null>;
  setFavorite(chatId: string, msgId: number, favorite: boolean): Promise<void>;
}
