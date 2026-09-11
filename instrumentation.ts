import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Starts the Postgres-backed ingestion job worker (see
    // src/lib/ingestion/jobQueue.ts) once per server process. Dynamic import
    // so this module — which touches the database — is never pulled into
    // the edge runtime bundle.
    const { startIngestionWorker } = await import("./src/lib/ingestion/jobQueue");
    startIngestionWorker();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// A no-op if Sentry was never initialized (no SENTRY_DSN) — safe to export
// unconditionally.
export const onRequestError = Sentry.captureRequestError;
