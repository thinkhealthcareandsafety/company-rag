/**
 * Idempotent schema bootstrap, run via `npm run db:migrate`.
 *
 * Kept as plain SQL (rather than drizzle-kit's generated migration journal) so
 * the project is runnable immediately against a fresh pgvector database without
 * a prior `drizzle-kit generate` step. If you evolve src/lib/db/schema.ts,
 * update this file to match, or switch to drizzle-kit migrations once the
 * schema stabilizes.
 */
import postgres from "postgres";
import { getDatabaseEnv } from "@/lib/env";

async function main() {
  const sql = postgres(getDatabaseEnv().DATABASE_URL, { max: 1 });

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(320) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'processing',
        failure_reason TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(768) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx ON document_chunks (document_id)`;
    // HNSW index for approximate nearest-neighbor cosine search — keeps top-k
    // retrieval fast (sub-100ms) as chunk count grows into the millions.
    await sql`
      CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
      ON document_chunks USING hnsw (embedding vector_cosine_ops)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS crm_entity_index (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        zoho_record_id VARCHAR(64) NOT NULL,
        module VARCHAR(40) NOT NULL,
        display_name TEXT NOT NULL,
        search_tokens TEXT NOT NULL,
        last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS crm_entity_index_search_tokens_idx ON crm_entity_index (search_tokens)`;

    console.log("Schema is up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
