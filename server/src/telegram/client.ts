import { Api, TelegramClient, utils } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import type { ChatInfo } from './vault.js';

export function createClient(apiId: number, apiHash: string, session = ''): TelegramClient {
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });
}

/** Map a GramJS dialog entity to ChatInfo. Returns null for entity types we don't model. */
export function toChatInfo(e: unknown): ChatInfo | null {
  const base = {
    usernames: [] as string[],
    forum: false,
    left: false,
    kicked: false,
    deactivated: false,
  };

  if (e instanceof Api.User) {
    return {
      ...base,
      id: String(utils.getPeerId(e)),
      kind: e.bot ? 'bot' : 'user',
      title: [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || String(e.id),
    };
  }
  if (e instanceof Api.Chat) {
    return {
      ...base,
      id: String(utils.getPeerId(e)),
      kind: 'group',
      title: e.title,
      left: !!e.left,
      deactivated: !!e.deactivated || !!e.migratedTo,
    };
  }
  if (e instanceof Api.ChatForbidden) {
    return { ...base, id: String(utils.getPeerId(e)), kind: 'group', title: e.title, kicked: true };
  }
  if (e instanceof Api.Channel) {
    const names = [
      ...(e.username ? [e.username] : []),
      ...(e.usernames ?? []).filter((u) => u.active).map((u) => u.username),
    ];
    return {
      ...base,
      id: String(utils.getPeerId(e)),
      kind: e.megagroup ? 'supergroup' : 'channel',
      title: e.title,
      usernames: [...new Set(names)],
      forum: !!e.forum,
      left: !!e.left,
      kicked: !!e.bannedRights?.viewMessages,
    };
  }
  if (e instanceof Api.ChannelForbidden) {
    return {
      ...base,
      id: String(utils.getPeerId(e)),
      kind: e.megagroup ? 'supergroup' : 'channel',
      title: e.title,
      kicked: true,
    };
  }
  return null;
}
