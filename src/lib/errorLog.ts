import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { errorLogs } from "@/lib/db/schema";

const RETENTION_LIMIT = 500;

/**
 * Single entry point for "something broke" across the app: logs to the
 * console (always available), forwards to Sentry (external dashboard, only
 * active once SENTRY_DSN is set), and writes a row so anyone signed in can
 * see it on the in-app Errors page without needing a Sentry account.
 *
 * Never throws — a broken error-logging path shouldn't take down the request
 * that was already failing.
 */
export async function logError(err: unknown, context?: Record<string, unknown>) {
  console.error("Logged error:", err, context);
  Sentry.captureException(err, context ? { extra: context } : undefined);

  try {
    await db.insert(errorLogs).values({
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: context ?? null,
    });
    await trimOldErrorLogs();
  } catch (dbErr) {
    console.error("Failed to persist error log:", dbErr);
  }
}

// Keep the table small — this is a live debugging aid, not an audit log.
async function trimOldErrorLogs() {
  await db.execute(sql`
    DELETE FROM error_logs
    WHERE id NOT IN (SELECT id FROM error_logs ORDER BY created_at DESC LIMIT ${RETENTION_LIMIT})
  `);
}
