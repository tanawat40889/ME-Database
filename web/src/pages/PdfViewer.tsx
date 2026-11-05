import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function Page({
  doc,
  n,
  width,
  ratio,
}: {
  doc: PDFDocumentProxy;
  n: number;
  width: number;
  ratio: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => setNear(e[0].isIntersecting), {
      rootMargin: '1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !width || !canvas.current) return;
    let task: { cancel(): void; promise: Promise<unknown> } | undefined;
    let dead = false;
    doc.getPage(n).then((page) => {
      if (dead || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale });
      const c = canvas.current;
      c.width = vp.width;
      c.height = vp.height;
      task = page.render({ canvas: c, viewport: vp });
      task.promise.catch(() => {}); // cancelled renders reject
    });
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [near, width, doc, n]);

  return (
    <div
      ref={box}
      className="mx-auto mb-3 bg-white shadow-sm"
      style={{ width, aspectRatio: `1 / ${ratio}` }}
    >
      {near && <canvas ref={canvas} className="block size-full" aria-label={`หน้า ${n}`} />}
    </div>
  );
}

/** pdf.js with HTTP Range: only the pages you scroll to are fetched */
export default function PdfViewer({ url }: { url: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let dead = false; // a destroyed task rejects with "Loading aborted": not an error for the UI
    const task = pdfjs.getDocument({ url, rangeChunkSize: 256 * 1024, disableAutoFetch: true });
    task.promise.then(
      async (d) => {
        const v = (await d.getPage(1)).getViewport({ scale: 1 });
        if (dead) return;
        setRatio(v.height / v.width);
        setDoc(d);
      },
      (e: unknown) => {
        if (!dead) setErr(e instanceof Error ? e.message : 'เปิด PDF ไม่ได้');
      },
    );
    return () => {
      dead = true;
      void task.destroy();
    };
  }, [url]);

  return (
    <div ref={wrap} className="bg-neutral-200 p-0 py-3 dark:bg-neutral-800">
      {err && (
        <p role="alert" className="p-4 text-center text-sm text-rose-600">
          {err}
        </p>
      )}
      {!doc && !err && <p className="p-6 text-center text-sm text-neutral-500">กำลังเปิด PDF…</p>}
      {doc &&
        width > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <Page key={i} doc={doc} n={i + 1} width={width} ratio={ratio} />
        ))}
    </div>
  );
}
