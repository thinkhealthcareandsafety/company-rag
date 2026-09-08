import { z } from "zod";

/**
 * Split into per-subsystem schemas, each validated independently, rather than
 * one all-or-nothing bundle. A script that only touches Postgres (db:migrate)
 * shouldn't fail because Zoho/Gemini credentials aren't configured yet — each
 * accessor below fails fast only when its own subsystem is actually used.
 */

const databaseSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

const geminiSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
});

const zohoSchema = z.object({
  ZOHO_CLIENT_ID: z.string().min(1, "ZOHO_CLIENT_ID is required"),
  ZOHO_CLIENT_SECRET: z.string().min(1, "ZOHO_CLIENT_SECRET is required"),
  ZOHO_REFRESH_TOKEN: z.string().min(1, "ZOHO_REFRESH_TOKEN is required"),
  ZOHO_ACCOUNTS_BASE_URL: z.string().url().default("https://accounts.zoho.com"),
  ZOHO_API_BASE_URL: z.string().url().default("https://www.zohoapis.com"),
});

const zohoBooksSchema = z.object({
  ZOHO_BOOKS_ORGANIZATION_ID: z.string().min(1, "ZOHO_BOOKS_ORGANIZATION_ID is required"),
});

function validate<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid ${label} environment configuration — ${issues}`);
  }
  return parsed.data;
}

let dbEnv: z.infer<typeof databaseSchema> | undefined;
export function getDatabaseEnv() {
  return (dbEnv ??= validate(databaseSchema, "database"));
}

let geminiEnv: z.infer<typeof geminiSchema> | undefined;
export function getGeminiEnv() {
  return (geminiEnv ??= validate(geminiSchema, "Gemini"));
}

let zohoEnv: z.infer<typeof zohoSchema> | undefined;
export function getZohoEnv() {
  return (zohoEnv ??= validate(zohoSchema, "Zoho CRM"));
}

let zohoBooksEnv: z.infer<typeof zohoBooksSchema> | undefined;
export function getZohoBooksEnv() {
  return (zohoBooksEnv ??= validate(zohoBooksSchema, "Zoho Books"));
}

/**
 * Redis is optional infrastructure (shared rate-limit state across multiple
 * server instances) — unlike the schemas above, missing config here isn't an
 * error, it just means the caller should fall back to an in-memory limiter.
 */
export function getRedisEnv(): { UPSTASH_REDIS_REST_URL: string; UPSTASH_REDIS_REST_TOKEN: string } | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  return { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token };
}

/**
 * Scheduled email digest is opt-in infrastructure, same reasoning as Redis
 * above — missing config just means the send endpoint declines to send
 * rather than the app failing to start.
 */
export function getDigestEmailEnv():
  | { RESEND_API_KEY: string; DIGEST_EMAIL_TO: string; DIGEST_EMAIL_FROM: string }
  | undefined {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  if (!apiKey || !to) return undefined;
  return { RESEND_API_KEY: apiKey, DIGEST_EMAIL_TO: to, DIGEST_EMAIL_FROM: process.env.DIGEST_EMAIL_FROM || "onboarding@resend.dev" };
}
