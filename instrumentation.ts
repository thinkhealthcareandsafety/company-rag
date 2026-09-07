import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// A no-op if Sentry was never initialized (no SENTRY_DSN) — safe to export
// unconditionally.
export const onRequestError = Sentry.captureRequestError;
