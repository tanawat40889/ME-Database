export interface SeqMsg {
  id: number;
  kind: 'media' | 'text' | 'tombstone';
  date: number;
  groupedId?: string;
  text: string;
}

export interface Unit {
  key: number; // first message id of the item
  messageIds: number[];
  groupedId?: string;
  description: string;
}

interface Cur extends Unit {
  ghost: boolean; // deleted media: swallows following text so it never moves to an earlier item
  lastDate: number;
  parts: string[];
}

/**
 * Bind text-only messages to the latest preceding media item (SPEC §5).
 * `seq` = all messages of ONE (chat, topic). Returns one Unit per media item/album.
 */
export function bindDescriptions(seq: SeqMsg[], windowMin = 0): Unit[] {
  const units: Cur[] = [];
  let cur: Cur | null = null;

  for (const m of [...seq].sort((a, b) => a.id - b.id)) {
    if (m.kind === 'tombstone') {
      cur = {
        key: m.id,
        messageIds: [],
        description: '',
        ghost: true,
        lastDate: m.date,
        parts: [],
      };
    } else if (m.kind === 'media') {
      if (cur && !cur.ghost && m.groupedId && cur.groupedId === m.groupedId) {
        cur.messageIds.push(m.id);
        cur.lastDate = m.date;
        continue;
      }
      cur = {
        key: m.id,
        messageIds: [m.id],
        groupedId: m.groupedId,
        description: '',
        ghost: false,
        lastDate: m.date,
        parts: [],
      };
      units.push(cur);
    } else {
      if (!cur || cur.ghost) continue; // before first media, or media was deleted
      if (m.text.trimStart().startsWith('//')) continue; // note
      if (windowMin > 0 && m.date - cur.lastDate > windowMin * 60) continue;
      cur.parts.push(m.text);
    }
  }

  return units.map(({ key, messageIds, groupedId, parts }) => ({
    key,
    messageIds,
    groupedId,
    description: parts.join('\n'),
  }));
}
