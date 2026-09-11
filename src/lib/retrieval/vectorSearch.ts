import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { embedTexts } from "@/lib/ingestion/embed";
import { rerankChunks } from "./rerank";

export interface RetrievedChunk {
  documentId: string;
  filename: string;
  content: string;
  page: number | null;
  heading: string | null;
  // 0-1, higher is more relevant. After hybrid fusion + reranking this is no
  // longer raw cosine similarity — see the fusion note below — so treat it
  // as "how confident the pipeline is", not a precise distance metric.
  relevance: number;
}

interface CandidateRow {
  [key: string]: unknown;
  id: string;
  document_id: string;
  filename: string;
  content: string;
  page: number | null;
  heading: string | null;
}

const FUSION_CANDIDATES_MULTIPLIER = 4; // fetch more than top_k from each leg so fusion+rerank have real signal to work with
const MIN_FUSION_CANDIDATES = 20;
const RRF_K = 60; // standard Reciprocal Rank Fusion constant — dampens the gap between rank 1 and rank 2 vs. raw scores

/**
 * Hybrid retrieval: fuses a dense vector (pgvector ANN cosine) search with a
 * sparse keyword (Postgres full-text, tsvector/tsquery) search via
 * Reciprocal Rank Fusion, then reranks the fused shortlist with one LLM call
 * before returning the final top_k.
 *
 * Why hybrid: vector search alone misses exact-term matches that don't
 * cluster semantically — a policy number, an item SKU, an acronym the
 * embedding model has never seen used that way. Keyword search alone misses
 * paraphrases ("post-operative leave" vs. "time off after surgery"). RRF
 * combines both rankings without needing to calibrate cosine-similarity and
 * ts_rank scores onto the same scale, which is not straightforward.
 *
 * Only searches chunks belonging to documents with status='ready' so a
 * document mid-ingest or a failed re-ingest never surfaces stale/partial
 * content.
 */
export async function searchDocuments(query: string, topK = 6): Promise<RetrievedChunk[]> {
  const fusionCandidates = Math.max(MIN_FUSION_CANDIDATES, topK * FUSION_CANDIDATES_MULTIPLIER);

  const [queryEmbedding] = await embedTexts([query]);
  const vectorLiteral = `[${queryEmbedding!.join(",")}]`;

  const [vectorRows, keywordRows] = await Promise.all([
    db.execute<CandidateRow>(sql`
      SELECT
        dc.id, dc.document_id, d.filename, dc.content,
        (dc.metadata->>'page')::int AS page,
        dc.metadata->>'heading' AS heading
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE d.status = 'ready'
      ORDER BY dc.embedding <=> ${vectorLiteral}::vector
      LIMIT ${fusionCandidates}
    `),
    db.execute<CandidateRow>(sql`
      SELECT
        dc.id, dc.document_id, d.filename, dc.content,
        (dc.metadata->>'page')::int AS page,
        dc.metadata->>'heading' AS heading
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE d.status = 'ready'
        AND to_tsvector('english', dc.content) @@ plainto_tsquery('english', ${query})
      ORDER BY ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', ${query})) DESC
      LIMIT ${fusionCandidates}
    `),
  ]);

  const fused = new Map<string, { row: CandidateRow; score: number }>();
  const addRanked = (rows: CandidateRow[]) => {
    rows.forEach((row, rank) => {
      const prior = fused.get(row.id);
      fused.set(row.id, { row: prior?.row ?? row, score: (prior?.score ?? 0) + 1 / (RRF_K + rank + 1) });
    });
  };
  addRanked(vectorRows);
  addRanked(keywordRows);

  if (fused.size === 0) return [];

  const maxScore = Math.max(...[...fused.values()].map((f) => f.score));
  const fusedSorted = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, fusionCandidates)
    .map((f) => ({ ...f, relevance: maxScore > 0 ? f.score / maxScore : 0 }));

  const rerankedIds = await rerankChunks(
    query,
    fusedSorted.map((f) => ({ id: f.row.id, content: f.row.content })),
    topK,
  );

  const finalEntries =
    rerankedIds.length > 0
      ? rerankedIds
          .map((id) => fusedSorted.find((f) => f.row.id === id))
          .filter((e): e is (typeof fusedSorted)[number] => e !== undefined)
      : fusedSorted.slice(0, topK); // reranker unavailable — fall back to the fused order

  return finalEntries.map(({ row, relevance }) => ({
    documentId: row.document_id,
    filename: row.filename,
    content: row.content,
    page: row.page,
    heading: row.heading,
    relevance: Number(relevance.toFixed(3)),
  }));
}
