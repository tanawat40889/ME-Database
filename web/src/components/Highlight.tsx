import { splitHighlight } from '../lib/highlight';

export function Highlight({ text, q }: { text: string; q?: string }) {
  return (
    <>
      {splitHighlight(text, q).map((s, i) =>
        s.hit ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40"
          >
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </>
  );
}
