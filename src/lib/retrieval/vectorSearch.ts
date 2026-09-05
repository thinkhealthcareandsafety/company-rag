import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { embedTexts } from "@/lib/ingestion/embed";

export interface RetrievedChunk {
  documentId: string;
  filename: string;
  content: string;
  page: number | null;
  heading: string | null;
  similarity: number;
}

/**
 * Embeds the query and runs an ANN cosine-similarity search via the pgvector
 * `<=>` operator (backed by the HNSW index from db/migrate.ts). Only searches
 * chunks belonging to documents with status='ready' so a document mid-ingest
 * or a failed re-ingest never surfaces stale/partial content.
 */
export async function searchDocuments(query: string, topK = 6): Promise<RetrievedChunk[]> {
  const [queryEmbedding] = await embedTexts([query]);
  const vectorLiteral = `[${queryEmbedding!.join(",")}]`;

  const rows = await db.execute<{
    document_id: string;
    filename: string;
    content: string;
    page: number | null;
    heading: string | null;
    similarity: number;
  }>(sql`
    SELECT
      dc.document_id,
      d.filename,
      dc.content,
      (dc.metadata->>'page')::int AS page,
      dc.metadata->>'heading' AS heading,
      1 - (dc.embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE d.status = 'ready'
    ORDER BY dc.embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `);

  return rows.map((r) => ({
    documentId: r.document_id,
    filename: r.filename,
    content: r.content,
    page: r.page,
    heading: r.heading,
    similarity: Number(r.similarity),
  }));
}
