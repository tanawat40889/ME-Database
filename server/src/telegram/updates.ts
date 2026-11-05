import { Api, utils } from 'telegram';
import type { LiveEvent } from '../index/live.js';
import { isFavorite, toRaw, topicOf } from './messages.js';

export interface UpdateCtx {
  isVault(chatId: string): boolean;
  forum(chatId: string): boolean;
  favEmoji: string;
  selfId: string;
}

const peerId = (p: Api.TypePeer) => String(utils.getPeerId(p));
const channelPeer = (id: Api.long) =>
  String(utils.getPeerId(new Api.PeerChannel({ channelId: id })));

function service(m: Api.MessageService, ctx: UpdateCtx): LiveEvent[] {
  const chatId = peerId(m.peerId);
  const a = m.action;
  const vault = ctx.isVault(chatId);

  if (a instanceof Api.MessageActionTopicCreate) {
    return vault
      ? [
          {
            t: 'topic',
            chatId,
            topicId: m.id,
            create: true,
            title: a.title,
            iconEmojiId: a.iconEmojiId ? String(a.iconEmojiId) : undefined,
          },
        ]
      : [];
  }
  if (a instanceof Api.MessageActionTopicEdit) {
    if (!vault) return [];
    return [
      {
        t: 'topic',
        chatId,
        topicId: topicOf(m.replyTo instanceof Api.MessageReplyHeader ? m.replyTo : undefined),
        create: false,
        title: a.title,
        iconEmojiId: a.iconEmojiId ? String(a.iconEmojiId) : undefined,
        closed: typeof a.closed === 'boolean' ? a.closed : undefined,
      },
    ];
  }

  const me = (id: { toString(): string }) => String(id) === ctx.selfId;
  if (
    a instanceof Api.MessageActionChatEditTitle ||
    a instanceof Api.MessageActionChatCreate ||
    a instanceof Api.MessageActionChannelCreate ||
    a instanceof Api.MessageActionChatMigrateTo ||
    a instanceof Api.MessageActionChannelMigrateFrom ||
    (a instanceof Api.MessageActionChatAddUser && a.users.some(me)) ||
    (a instanceof Api.MessageActionChatDeleteUser && me(a.userId))
  ) {
    return [{ t: 'reconcile' }];
  }
  return [];
}

/** Raw GramJS update → zero or more index events. Chats outside the vault are never touched. */
export function translateUpdate(u: unknown, ctx: UpdateCtx): LiveEvent[] {
  if (
    u instanceof Api.UpdateNewMessage ||
    u instanceof Api.UpdateNewChannelMessage ||
    u instanceof Api.UpdateEditMessage ||
    u instanceof Api.UpdateEditChannelMessage
  ) {
    const m = u.message;
    if (m instanceof Api.MessageService) return service(m, ctx);
    if (!(m instanceof Api.Message)) return [];
    const chatId = peerId(m.peerId);
    if (!ctx.isVault(chatId)) return [];
    const raw = toRaw(m, chatId, ctx.forum(chatId), ctx.favEmoji);
    return raw ? [{ t: 'msg', msg: raw }] : [];
  }
  if (u instanceof Api.UpdateDeleteMessages) {
    return [{ t: 'delete', chatId: null, ids: u.messages }];
  }
  if (u instanceof Api.UpdateDeleteChannelMessages) {
    const chatId = channelPeer(u.channelId);
    return ctx.isVault(chatId) ? [{ t: 'delete', chatId, ids: u.messages }] : [];
  }
  if (u instanceof Api.UpdateMessageReactions) {
    const chatId = peerId(u.peer);
    return ctx.isVault(chatId)
      ? [{ t: 'reaction', chatId, id: u.msgId, favorite: isFavorite(u.reactions, ctx.favEmoji) }]
      : [];
  }
  if (u instanceof Api.UpdateChannel || u instanceof Api.UpdateChat) {
    return [{ t: 'reconcile' }];
  }
  if (
    (u instanceof Api.UpdateChatParticipantAdd ||
      u instanceof Api.UpdateChatParticipantDelete ||
      u instanceof Api.UpdateChannelParticipant) &&
    String(u.userId) === ctx.selfId
  ) {
    return [{ t: 'reconcile' }];
  }
  return [];
}
