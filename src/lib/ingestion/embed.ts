import { getGemini, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "@/lib/gemini";

const BATCH_SIZE = 32; // Gemini's free tier has tighter per-minute rate limits than a paid plan

/**
 * Embeds many chunks of text in batched requests rather than one call per
 * chunk — cuts both latency and request overhead for a multi-hundred-page
 * document. Retries once (with backoff, since free-tier rate limits are the
 * likeliest transient failure) before giving up on a batch.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const gemini = getGemini();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatchWithRetry(gemini, batch);
    results.push(...embeddings);
  }

  return results;
}

async function embedBatchWithRetry(gemini: ReturnType<typeof getGemini>, batch: string[], attempt = 0): Promise<number[][]> {
  try {
    const response = await gemini.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    const embeddings = response.embeddings;
    if (!embeddings || embeddings.length !== batch.length) {
      throw new Error(`Embedding response size mismatch: expected ${batch.length}, got ${embeddings?.length ?? 0}`);
    }
    return embeddings.map((e) => {
      if (!e.values) throw new Error("Embedding response missing values");
      return e.values;
    });
  } catch (err) {
    if (attempt >= 1) throw err;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return embedBatchWithRetry(gemini, batch, attempt + 1);
  }
}
