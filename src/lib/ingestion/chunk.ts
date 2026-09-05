import { encode } from "gpt-tokenizer";
import type { ExtractedPage } from "./extractText";

export interface Chunk {
  content: string;
  page: number;
  heading?: string;
}

const TARGET_TOKENS = 600;
const OVERLAP_TOKENS = 90; // ~15% of target — keeps context continuous across a chunk boundary
const HEADING_PATTERN = /^(#{1,6}\s|[A-Z][A-Z0-9 &/-]{3,60}$|\d+(\.\d+)*\s+[A-Z])/;

/**
 * Token-aware recursive splitter: paragraph boundaries first, then sentences,
 * only falling back to a hard token cut if a single paragraph/sentence still
 * exceeds the target. This keeps chunks precise (a paragraph is a coherent
 * retrieval unit) while guaranteeing no chunk blows past the embedding budget.
 */
export function chunkPages(pages: ExtractedPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  let currentHeading: string | undefined;

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}|(?<=[.!?])\s{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    let buffer = "";
    let bufferTokens = 0;

    const flush = () => {
      if (buffer.trim()) {
        chunks.push({ content: buffer.trim(), page: page.page, heading: currentHeading });
      }
      buffer = "";
      bufferTokens = 0;
    };

    for (const paragraph of paragraphs) {
      if (HEADING_PATTERN.test(paragraph) && paragraph.length < 80) {
        currentHeading = paragraph;
      }

      const units = splitIntoTokenBoundedUnits(paragraph, TARGET_TOKENS);

      for (const unit of units) {
        const unitTokens = encode(unit).length;

        if (bufferTokens + unitTokens > TARGET_TOKENS && buffer) {
          flush();
          // carry a token-overlap tail forward so retrieval near a chunk
          // boundary doesn't lose surrounding context
          const overlapText = takeLastTokens(buffer, OVERLAP_TOKENS);
          buffer = overlapText;
          bufferTokens = encode(overlapText).length;
        }

        buffer = buffer ? `${buffer} ${unit}` : unit;
        bufferTokens += unitTokens;
      }
    }

    flush();
  }

  return chunks;
}

/** Splits a paragraph into sentence-level pieces if it alone exceeds the token budget. */
function splitIntoTokenBoundedUnits(paragraph: string, maxTokens: number): string[] {
  if (encode(paragraph).length <= maxTokens) return [paragraph];

  const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
  const units: string[] = [];

  for (const sentence of sentences) {
    if (encode(sentence).length <= maxTokens) {
      units.push(sentence);
      continue;
    }
    // pathological case: a single sentence longer than the budget — hard cut by words
    const words = sentence.split(/\s+/);
    let piece: string[] = [];
    for (const word of words) {
      piece.push(word);
      if (encode(piece.join(" ")).length >= maxTokens) {
        units.push(piece.join(" "));
        piece = [];
      }
    }
    if (piece.length) units.push(piece.join(" "));
  }

  return units;
}

function takeLastTokens(text: string, tokenCount: number): string {
  const words = text.split(/\s+/);
  let acc = "";
  for (let i = words.length - 1; i >= 0; i--) {
    const candidate = words[i] + (acc ? " " + acc : "");
    if (encode(candidate).length > tokenCount) break;
    acc = candidate;
  }
  return acc;
}
