import { Api } from 'telegram';
import bigInt from 'big-integer';
import { describe, expect, it } from 'vitest';
import { classify, isFavorite, toRaw, topicOf } from './messages.js';

const rx = (emoji: string, chosenOrder?: number) =>
  new Api.ReactionCount({
    chosenOrder,
    count: 1,
    reaction: new Api.ReactionEmoji({ emoticon: emoji }),
  });
const reactions = (...r: Api.ReactionCount[]) => new Api.MessageReactions({ results: r });

describe('topicOf', () => {
  it('non-forum reply / no reply → General', () => {
    expect(topicOf(undefined)).toBe(1);
    expect(topicOf({ replyToMsgId: 55 })).toBe(1);
  });
  it('forum: replyToTopId wins, else replyToMsgId', () => {
    expect(topicOf({ forumTopic: true, replyToTopId: 7, replyToMsgId: 99 })).toBe(7);
    expect(topicOf({ forumTopic: true, replyToMsgId: 7 })).toBe(7);
  });
});

describe('isFavorite', () => {
  it('needs chosenOrder (we reacted)', () => {
    expect(isFavorite(reactions(rx('❤', 0)), '❤️')).toBe(true);
    expect(isFavorite(reactions(rx('❤')), '❤️')).toBe(false);
  });
  it('ignores other emoji and missing reactions', () => {
    expect(isFavorite(reactions(rx('👍', 0)), '❤️')).toBe(false);
    expect(isFavorite(undefined, '❤️')).toBe(false);
  });
  it('variation selector insensitive', () => {
    expect(isFavorite(reactions(rx('❤️', 1)), '❤')).toBe(true);
  });
});

describe('classify', () => {
  it.each([
    ['video/mp4', false, 'video'],
    ['application/octet-stream', true, 'video'],
    ['application/pdf', false, 'pdf'],
    ['image/png', false, 'image'],
    ['application/zip', false, 'file'],
    [undefined, false, 'file'],
  ] as const)('%s video=%s → %s', (mime, v, out) => {
    expect(classify(mime, v)).toBe(out);
  });
});

const doc = (mime: string, attributes: Api.TypeDocumentAttribute[] = []) =>
  new Api.MessageMediaDocument({
    document: new Api.Document({
      id: bigInt(1),
      accessHash: bigInt(1),
      fileReference: Buffer.alloc(0),
      date: 0,
      mimeType: mime,
      size: bigInt(1234),
      dcId: 1,
      attributes,
    }),
  });

describe('toRaw', () => {
  const base = {
    id: 10,
    peerId: new Api.PeerChannel({ channelId: bigInt(1) }),
    date: 1_700_000_000,
  };

  it('service messages are ignored', () => {
    const s = new Api.MessageService({
      ...base,
      action: new Api.MessageActionChatEditTitle({ title: 'x' }),
    });
    expect(toRaw(s, '-1001', false, '❤️')).toBeNull();
  });
  it('text message', () => {
    const r = toRaw(new Api.Message({ ...base, message: 'ซ้อม #ซ้อม' }), '-1001', false, '❤️')!;
    expect(r).toMatchObject({
      id: 10,
      kind: 'text',
      text: 'ซ้อม #ซ้อม',
      topicId: null,
      favorite: false,
    });
  });
  it('empty non-media message is ignored', () => {
    expect(toRaw(new Api.Message({ ...base, message: '  ' }), '-1001', false, '❤️')).toBeNull();
  });
  it('video document with attributes, caption, group, favorite, forum topic', () => {
    const msg = new Api.Message({
      ...base,
      message: 'cap',
      groupedId: bigInt(99),
      media: doc('video/mp4', [
        new Api.DocumentAttributeFilename({ fileName: 'a.mp4' }),
        new Api.DocumentAttributeVideo({ duration: 12, w: 1920, h: 1080 }),
      ]),
      reactions: reactions(rx('❤', 0)),
      replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToTopId: 5, replyToMsgId: 8 }),
    });
    expect(toRaw(msg, '-1001', true, '❤️')).toMatchObject({
      kind: 'media',
      groupedId: '99',
      topicId: 5,
      text: 'cap',
      favorite: true,
      media: {
        type: 'video',
        fileName: 'a.mp4',
        mimeType: 'video/mp4',
        size: 1234,
        duration: 12,
        width: 1920,
        height: 1080,
      },
    });
  });
  it('pdf and generic file', () => {
    expect(
      toRaw(new Api.Message({ ...base, media: doc('application/pdf') }), 'c', false, '❤️')?.media
        ?.type,
    ).toBe('pdf');
    expect(
      toRaw(new Api.Message({ ...base, media: doc('application/zip') }), 'c', false, '❤️')?.media
        ?.type,
    ).toBe('file');
  });
  it('photo → image with largest size', () => {
    const photo = new Api.Photo({
      id: bigInt(1),
      accessHash: bigInt(1),
      fileReference: Buffer.alloc(0),
      date: 0,
      dcId: 1,
      sizes: [
        new Api.PhotoSize({ type: 's', w: 90, h: 60, size: 1000 }),
        new Api.PhotoSize({ type: 'x', w: 1280, h: 853, size: 90000 }),
      ],
    });
    const r = toRaw(
      new Api.Message({ ...base, media: new Api.MessageMediaPhoto({ photo }) }),
      'c',
      false,
      '❤️',
    )!;
    expect(r.media).toMatchObject({ type: 'image', width: 1280, height: 853, size: 90000 });
  });
});
