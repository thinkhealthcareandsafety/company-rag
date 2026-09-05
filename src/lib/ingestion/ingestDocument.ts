import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents, documentChunks } from "@/lib/db/schema";
import { extractPdfPages } from "./extractText";
import { chunkPages } from "./chunk";
import { embedTexts } from "./embed";

/**
 * Runs extract -> chunk -> embed -> store for one document, then flips its
 * status to ready/failed. Re-ingesting an existing document (same id, new
 * version) deletes its old chunks inside the same transaction as inserting
 * the new ones, so a reader never sees a mix of old and new chunks, and a
 * failure mid-ingest leaves the previous version intact rather than orphaned
 * partial rows.
 */
export async function ingestDocument(documentId: string, fileBuffer: Buffer): Promise<void> {
  try {
    const pages = await extractPdfPages(fileBuffer);
    if (pages.length === 0) {
      throw new Error("No extractable text found in PDF (scanned/image-only PDFs are not supported yet)");
    }

    const chunks = chunkPages(pages);
    if (chunks.length === 0) {
      throw new Error("Document produced no chunks after splitting");
    }

    const embeddings = await embedTexts(chunks.map((c) => c.content));

    await db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));

      await tx.insert(documentChunks).values(
        chunks.map((chunk, i) => ({
          documentId,
          chunkIndex: i,
          content: chunk.content,
          embedding: embeddings[i]!,
          metadata: { page: chunk.page, heading: chunk.heading ?? null },
        })),
      );

      await tx
        .update(documents)
        .set({ status: "ready", failureReason: null, updatedAt: new Date() })
        .where(eq(documents.id, documentId));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown ingestion error";
    await db
      .update(documents)
      .set({ status: "failed", failureReason: message, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    throw err;
  }
}
