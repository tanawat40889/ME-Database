import { Api } from 'telegram';

const stripVs = (e: string) => e.replace(/️/g, '');

export class FavoriteError extends Error {
  constructor(
    public code: 'chat_reaction_disabled' | 'not_found' | 'telegram_error',
    message: string,
  ) {
    super(message);
  }
}

/** Reactions WE chose on a message, in the order we chose them. */
export function chosenFrom(r: Api.MessageReactions | undefined): Api.TypeReaction[] {
  return (r?.results ?? [])
    .filter((x) => x.chosenOrder != null)
    .sort((a, b) => (a.chosenOrder ?? 0) - (b.chosenOrder ?? 0))
    .map((x) => x.reaction);
}

/** Keep every other reaction we already set; add or drop only the favorite emoji. */
export function nextReactions(
  chosen: Api.TypeReaction[],
  emoji: string,
  favorite: boolean,
): Api.TypeReaction[] {
  const want = stripVs(emoji);
  const isFav = (r: Api.TypeReaction) =>
    r instanceof Api.ReactionEmoji && stripVs(r.emoticon) === want;
  const others = chosen.filter((r) => !isFav(r));
  // Telegram's own reaction list uses the bare form (❤ not ❤️), so send it without the variation selector
  return favorite ? [...others, new Api.ReactionEmoji({ emoticon: want })] : others;
}

export interface ReactionIO {
  chosen(): Promise<Api.TypeReaction[]>;
  send(reaction: Api.TypeReaction[]): Promise<void>;
}

const code = (e: unknown): string =>
  String(
    (e as { errorMessage?: string; message?: string })?.errorMessage ?? (e as Error)?.message ?? e,
  );

export async function setFavoriteReaction(
  io: ReactionIO,
  emoji: string,
  favorite: boolean,
): Promise<void> {
  const next = nextReactions(await io.chosen(), emoji, favorite);
  try {
    await io.send(next);
  } catch (e) {
    const c = code(e);
    if (/REACTION_INVALID/.test(c)) {
      throw new FavoriteError(
        'chat_reaction_disabled',
        `ห้อง/กลุ่มนี้ไม่เปิด reaction ${emoji} — เปิดได้ในตั้งค่าแชท (channel: Channel Settings → Reactions)`,
      );
    }
    if (/REACTIONS_TOO_MANY/.test(c)) {
      // non-Premium accounts hold one reaction: keep only the favorite emoji
      await io.send(nextReactions([], emoji, favorite));
      return;
    }
    throw new FavoriteError('telegram_error', c);
  }
}
