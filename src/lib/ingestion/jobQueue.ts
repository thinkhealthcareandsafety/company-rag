import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents, ingestionJobs } from "@/lib/db/schema";
import { ingestDocument } from "./ingestDocument";
import { logError } from "@/lib/errorLog";

const POLL_INTERVAL_MS = 3_000;
// Exponential backoff between retries of the same failed job: 10s, 40s, 90s…
const RETRY_BACKOFF_BASE_MS = 10_000;

/**
 * Durable replacement for the old fire-and-forget `ingestDocument(...).catch()`
 * call in api/documents/route.ts. The upload route now only enqueues a row;
 * this worker (started once at server boot — see instrumentation.ts) claims
 * and processes jobs from Postgres itself, so:
 *
 *  - a server restart mid-ingest resumes the job instead of losing it
 *    (the file bytes are persisted in the job row, not held in process memory)
 *  - `FOR UPDATE SKIP LOCKED` lets multiple server instances share one queue
 *    safely without double-processing a job
 *  - a failing document retries with backoff instead of failing once and
 *    staying failed forever
 *
 * This is a Postgres-backed queue, not a message broker (no BullMQ/Redis) —
 * appropriate at this app's ingestion volume (documents uploaded by staff,
 * not a high-throughput pipeline). Move to a real broker + object storage
 * for the file bytes before this needs to scale past a handful of servers.
 */
export async function enqueueIngestionJob(documentId: string, fileBuffer: Buffer): Promise<void> {
  await db.insert(ingestionJobs).values({ documentId, fileBytes: fileBuffer, status: "queued" });
}

interface ClaimedJob {
  [key: string]: unknown;
  id: string;
  document_id: string;
  file_bytes: Buffer | null;
  attempts: number;
  max_attempts: number;
}

/** Atomically claims one due job, or null if the queue is empty right now. */
async function claimNextJob(): Promise<ClaimedJob | null> {
  const rows = await db.execute<ClaimedJob>(sql`
    UPDATE ingestion_jobs
    SET status = 'processing', updated_at = now()
    WHERE id = (
      SELECT id FROM ingestion_jobs
      WHERE status = 'queued' AND next_attempt_at <= now()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, document_id, file_bytes, attempts, max_attempts
  `);
  return rows[0] ?? null;
}

/** Processes exactly one job if one is due. Returns whether it did anything (for the poll loop to decide whether to check again immediately). */
export async function runOneIngestionJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;

  try {
    if (!job.file_bytes) throw new Error("Ingestion job has no file bytes — cannot process");

    await ingestDocument(job.document_id, job.file_bytes);

    // Success: clear the (potentially large) file bytes rather than deleting
    // the row outright, so completed jobs stay visible for troubleshooting.
    await db
      .update(ingestionJobs)
      .set({ status: "done", fileBytes: null, updatedAt: new Date() })
      .where(sql`id = ${job.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown ingestion error";
    const attempts = job.attempts + 1;
    const willRetry = attempts < job.max_attempts;

    await db
      .update(ingestionJobs)
      .set({
        status: willRetry ? "queued" : "failed",
        attempts,
        lastError: message,
        nextAttemptAt: willRetry ? new Date(Date.now() + RETRY_BACKOFF_BASE_MS * attempts * attempts) : undefined,
        fileBytes: willRetry ? undefined : null, // give up on a permanently failed job's bytes too
        updatedAt: new Date(),
      })
      .where(sql`id = ${job.id}`);

    if (!willRetry) {
      await db.update(documents).set({ status: "failed", failureReason: message, updatedAt: new Date() }).where(sql`id = ${job.document_id}`);
      await logError(err, { source: "ingestion_job_queue", documentId: job.document_id, attempts });
    }
  }

  return true;
}

let workerStarted = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts the polling loop once per process. Idempotent so it's safe to call
 * from instrumentation.ts (which itself can re-run in dev on hot reload).
 */
export function startIngestionWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const tick = async () => {
    try {
      // Drain everything currently due before sleeping, instead of one job
      // per poll interval — keeps a batch of uploads from queueing for
      // minutes when the actual work per document is a few seconds.
      let processedSomething = true;
      while (processedSomething) {
        processedSomething = await runOneIngestionJob();
      }
    } catch (err) {
      console.error("Ingestion worker tick failed:", err);
    } finally {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  void tick();
  console.log("Ingestion worker started (polling every %dms).", POLL_INTERVAL_MS);
}

// Exposed for tests/scripts that need a clean shutdown; unused in normal
// server operation (the process exits and takes the timer with it).
export function stopIngestionWorker(): void {
  if (pollTimer) clearTimeout(pollTimer);
  workerStarted = false;
}
