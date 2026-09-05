import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// pdfjs-dist's Node.js auto-detection doesn't reliably fire inside Next.js's
// server runtime, and pointing `workerSrc` at the worker file on disk doesn't
// work either — the file is pure ESM, which Next's `serverExternalPackages`
// can't `require()` (a Node.js constraint, not fixable via config), and
// letting Turbopack bundle it instead breaks the same dynamic file lookup.
// pdfjs checks `globalThis.pdfjsWorker` before ever trying to resolve
// `workerSrc`, so registering the handler directly — via a plain static
// import Turbopack CAN bundle correctly — sidesteps the whole problem.
(globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler } }).pdfjsWorker = {
  WorkerMessageHandler,
};

export interface ExtractedPage {
  page: number;
  text: string;
}

/**
 * Extracts text per-page (not as one flat blob) so downstream chunks can carry
 * an accurate page-number citation. Uses pdfjs-dist directly rather than the
 * `pdf-parse` wrapper package: pdf-parse bundles a stale, pre-built copy of
 * pdfjs behind a `pagerender` callback API that corrupts its own parser state
 * (throws spurious "bad XRef entry"/"Illegal character" errors) when loaded
 * through anything but a plain CJS `require` — including Next.js's own
 * bundler. pdfjs-dist is the actively maintained upstream library.
 */
export async function extractPdfPages(buffer: Buffer): Promise<ExtractedPage[]> {
  // verbosity: ERRORS — at ingestion volume ("thousands of files") the
  // default level logs a warning per document for benign fallback-font-metric
  // lookups that don't affect extracted text.
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pages: ExtractedPage[] = [];

  try {
    const doc = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pages.push({ page: pageNumber, text });
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages.filter((p) => p.text.trim().length > 0);
}
