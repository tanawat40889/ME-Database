import bigInt from 'big-integer';
import { Api } from 'telegram';
import { describe, expect, it } from 'vitest';
import { translateUpdate, type UpdateCtx } from './updates.js';

const CH = bigInt('1234567890');
const CHAT = '-1001234567890';
const peer = new Api.PeerChannel({ channelId: CH });
const base = { id: 10, peerId: peer, date: 1_700_000_000 };
const ctx = (o: Partial<UpdateCtx> = {}): UpdateCtx => ({
  isVault: (id) => id === CHAT,
  forum: () => false,
  favEmoji: '❤️',
  selfId: '42',
  ...o,
});
const newMsg = (m: Api.TypeMessage) =>
  new Api.UpdateNewChannelMessage({ message: m, pts: 0, ptsCount: 0 });
const svc = (
  action: Api.TypeMessageAction,
  o: Partial<{ peerId: Api.TypePeer; id: number }> = {},
) => newMsg(new Api.MessageService({ ...base, ...o, action }));
const heart = new Api.MessageReactions({
  results: [
    new Api.ReactionCount({
      chosenOrder: 0,
      count: 1,
      reaction: new Api.ReactionEmoji({ emoticon: '❤' }),
    }),
  ],
});

describe('messages', () => {
  it('new text in vault → msg', () => {
    const ev = translateUpdate(newMsg(new Api.Message({ ...base, message: 'ซ้อม' })), ctx());
    expect(ev).toEqual([
      expect.objectContaining({
        t: 'msg',
        msg: expect.objectContaining({ id: 10, kind: 'text', chatId: CHAT }),
      }),
    ]);
  });
  it('same message outside vault is ignored', () => {
    expect(
      translateUpdate(
        newMsg(new Api.Message({ ...base, message: 'x' })),
        ctx({ isVault: () => false }),
      ),
    ).toEqual([]);
  });
  it('edit → msg (with favorite from reactions)', () => {
    const u = new Api.UpdateEditChannelMessage({
      message: new Api.Message({ ...base, message: 'edited', reactions: heart }),
      pts: 0,
      ptsCount: 0,
    });
    const [ev] = translateUpdate(u, ctx());
    expect(ev).toMatchObject({ t: 'msg', msg: { text: 'edited', favorite: true } });
  });
  it('forum: topic taken from reply header', () => {
    const u = newMsg(
      new Api.Message({
        ...base,
        message: 'hi',
        replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToTopId: 7 }),
      }),
    );
    expect(translateUpdate(u, ctx({ forum: () => true }))[0]).toMatchObject({
      msg: { topicId: 7 },
    });
  });
  it('empty message ignored', () => {
    expect(translateUpdate(newMsg(new Api.Message({ ...base, message: '' })), ctx())).toEqual([]);
  });
});

describe('delete', () => {
  it('channel delete: only vault', () => {
    const u = new Api.UpdateDeleteChannelMessages({
      channelId: CH,
      messages: [1, 2],
      pts: 0,
      ptsCount: 0,
    });
    expect(translateUpdate(u, ctx())).toEqual([{ t: 'delete', chatId: CHAT, ids: [1, 2] }]);
    expect(translateUpdate(u, ctx({ isVault: () => false }))).toEqual([]);
  });
  it('basic group delete has no chat id', () => {
    const u = new Api.UpdateDeleteMessages({ messages: [5], pts: 0, ptsCount: 0 });
    expect(translateUpdate(u, ctx())).toEqual([{ t: 'delete', chatId: null, ids: [5] }]);
  });
});

describe('reactions', () => {
  const r = (reactions: Api.MessageReactions) =>
    new Api.UpdateMessageReactions({ peer, msgId: 9, reactions });
  it('my ❤ → favorite true', () => {
    expect(translateUpdate(r(heart), ctx())).toEqual([
      { t: 'reaction', chatId: CHAT, id: 9, favorite: true },
    ]);
  });
  it('removed → favorite false', () => {
    expect(translateUpdate(r(new Api.MessageReactions({ results: [] })), ctx())).toEqual([
      { t: 'reaction', chatId: CHAT, id: 9, favorite: false },
    ]);
  });
  it('outside vault ignored', () => {
    expect(translateUpdate(r(heart), ctx({ isVault: () => false }))).toEqual([]);
  });
});

describe('topics', () => {
  it('create', () => {
    const ev = translateUpdate(
      svc(
        new Api.MessageActionTopicCreate({
          title: 'ซ้อมดนตรี',
          iconColor: 1,
          iconEmojiId: bigInt(5),
        }),
        { id: 77 },
      ),
      ctx(),
    );
    expect(ev).toEqual([
      { t: 'topic', chatId: CHAT, topicId: 77, create: true, title: 'ซ้อมดนตรี', iconEmojiId: '5' },
    ]);
  });
  it('edit: title + closed, topic from reply header', () => {
    const m = new Api.MessageService({
      ...base,
      replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToMsgId: 77 }),
      action: new Api.MessageActionTopicEdit({ title: 'new', closed: true }),
    });
    expect(translateUpdate(newMsg(m), ctx())).toEqual([
      {
        t: 'topic',
        chatId: CHAT,
        topicId: 77,
        create: false,
        title: 'new',
        iconEmojiId: undefined,
        closed: true,
      },
    ]);
  });
  it('topic events outside vault ignored', () => {
    expect(
      translateUpdate(
        svc(new Api.MessageActionTopicCreate({ title: 'x', iconColor: 1 })),
        ctx({ isVault: () => false }),
      ),
    ).toEqual([]);
  });
});

describe('vault rule changes → reconcile', () => {
  const R = [{ t: 'reconcile' }];
  it('rename, even in a chat not (yet) in the vault', () => {
    expect(
      translateUpdate(
        svc(new Api.MessageActionChatEditTitle({ title: 'TBackup x' })),
        ctx({ isVault: () => false }),
      ),
    ).toEqual(R);
  });
  it('created / migrated', () => {
    expect(
      translateUpdate(svc(new Api.MessageActionChatCreate({ title: 'x', users: [] })), ctx()),
    ).toEqual(R);
    expect(
      translateUpdate(svc(new Api.MessageActionChatMigrateTo({ channelId: CH })), ctx()),
    ).toEqual(R);
    expect(
      translateUpdate(
        svc(new Api.MessageActionChannelMigrateFrom({ title: 'x', chatId: bigInt(1) })),
        ctx(),
      ),
    ).toEqual(R);
  });
  it('self added / removed, but not other people', () => {
    expect(
      translateUpdate(svc(new Api.MessageActionChatAddUser({ users: [bigInt(42)] })), ctx()),
    ).toEqual(R);
    expect(
      translateUpdate(svc(new Api.MessageActionChatAddUser({ users: [bigInt(7)] })), ctx()),
    ).toEqual([]);
    expect(
      translateUpdate(svc(new Api.MessageActionChatDeleteUser({ userId: bigInt(42) })), ctx()),
    ).toEqual(R);
    expect(
      translateUpdate(svc(new Api.MessageActionChatDeleteUser({ userId: bigInt(7) })), ctx()),
    ).toEqual([]);
  });
  it('UpdateChannel / UpdateChat', () => {
    expect(translateUpdate(new Api.UpdateChannel({ channelId: CH }), ctx())).toEqual(R);
    expect(translateUpdate(new Api.UpdateChat({ chatId: bigInt(1) }), ctx())).toEqual(R);
  });
  it('participant updates only for self', () => {
    const mk = (userId: number) =>
      new Api.UpdateChatParticipantDelete({
        chatId: bigInt(1),
        userId: bigInt(userId),
        version: 1,
      });
    expect(translateUpdate(mk(42), ctx())).toEqual(R);
    expect(translateUpdate(mk(7), ctx())).toEqual([]);
  });
  it('unrelated updates → nothing', () => {
    expect(
      translateUpdate(
        new Api.UpdateUserStatus({
          userId: bigInt(1),
          status: new Api.UserStatusOnline({ expires: 1 }),
        }),
        ctx(),
      ),
    ).toEqual([]);
    expect(translateUpdate('garbage', ctx())).toEqual([]);
  });
});
