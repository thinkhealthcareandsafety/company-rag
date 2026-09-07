import * as Sentry from "@sentry/nextjs";

// Sentry.init() with no dsn is a documented no-op — this file stays a single
// unconditional call so local dev and CI never need SENTRY_DSN set.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
