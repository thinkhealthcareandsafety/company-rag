import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseEnv } from "@/lib/env";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var __ragDbClient: ReturnType<typeof postgres> | undefined;
  var __ragDb: DrizzleDb | undefined;
}

/**
 * Reuse a single connection pool across hot reloads in dev (Next.js re-evaluates
 * modules on every request in dev mode; without this we'd leak connections).
 */
function getDb(): DrizzleDb {
  if (!global.__ragDb) {
    global.__ragDbClient ??= postgres(getDatabaseEnv().DATABASE_URL, { max: 10 });
    global.__ragDb = drizzle(global.__ragDbClient, { schema });
  }
  return global.__ragDb;
}

/**
 * Proxy defers connecting/validating env until a query actually runs, rather
 * than at module import time. Next.js imports every route module during
 * `next build` to collect route config (e.g. `export const runtime`) without
 * executing handlers — eagerly connecting here would fail the build in any
 * environment (CI included) that doesn't have live database credentials.
 */
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
