import { Type } from "@google/genai";
import { getGemini, CHAT_MODEL } from "@/lib/gemini";

export interface RerankCandidate {
  id: string;
  content: string;
}

const RERANK_TIMEOUT_MS = 8_000;
const CONTENT_PREVIEW_CHARS = 600; // enough for the model to judge relevance without a slow, expensive prompt

/**
 * Cross-checks a shortlist of hybrid-search candidates against the query
 * with one LLM call, and returns their ids in relevance order (best first).
 *
 * This exists because neither vector similarity nor keyword rank alone is a
 * great relevance signal — a passage can be the closest vector match while
 * still not actually answering the question, or vice versa for keyword
 * overlap. A dedicated cross-encoder reranker model would be the standard
 * enterprise answer here; this project has no infrastructure for hosting one,
 * so it reuses the same Gemini call already in the stack instead. Swap this
 * for a real reranker (e.g. Cohere Rerank, a self-hosted cross-encoder)
 * before relying on this at scale — an LLM call per search adds real latency
 * and cost that a purpose-built reranker avoids.
 *
 * Returns [] on any failure (timeout, malformed response) — the caller
 * degrades to the fused vector+keyword order rather than losing the search
 * entirely, so a rerank hiccup narrows quality, not availability.
 */
export async function rerankChunks(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]> {
  if (candidates.length === 0) return [];

  const gemini = getGemini();
  const listing = candidates
    .map((c, i) => `[${i}] (id: ${c.id})\n${c.content.slice(0, CONTENT_PREVIEW_CHARS)}`)
    .join("\n\n");

  const prompt = `Question: "${query}"

Below are ${candidates.length} candidate passages, each labeled with an index in brackets. Judge how well each
passage actually helps answer the question — not just topical overlap. Return the ${Math.min(topK, candidates.length)}
most relevant indices, best first. If fewer than that many are genuinely relevant, return only those.

${listing}`;

  try {
    const response = await withTimeout(
      gemini.models.generateContent({
        model: CHAT_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ranked_indices: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            },
            required: ["ranked_indices"],
          },
        },
      }),
      RERANK_TIMEOUT_MS,
    );

    const parsed = JSON.parse(response.text ?? "{}") as { ranked_indices?: number[] };
    const indices = Array.isArray(parsed.ranked_indices) ? parsed.ranked_indices : [];

    const ids = indices
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .map((i) => candidates[i]!.id);

    return [...new Set(ids)].slice(0, topK);
  } catch (err) {
    console.error("Reranking failed, falling back to fused retrieval order:", err);
    return [];
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Rerank call exceeded ${ms}ms timeout`)), ms)),
  ]);
}
