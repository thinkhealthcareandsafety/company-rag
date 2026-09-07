import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {};

// withSentryConfig only uploads source maps / wraps build output when
// SENTRY_AUTH_TOKEN + org/project are set — harmless no-op otherwise, so this
// stays unconditional rather than gated on env vars being present.
export default withSentryConfig(nextConfig, {
  silent: true,
});
