import { and, ilike, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { crmEntityIndex } from "@/lib/db/schema";

export interface ResolvedEntity {
  zohoRecordId: string;
  module: string;
  displayName: string;
}

/**
 * Resolves a name mentioned in a chat query (e.g. "Acme Corp") to candidate
 * Zoho record IDs using the locally-synced name index, so the agent doesn't
 * need to guess a record ID or run an expensive live search-by-name against
 * Zoho for every query. Actual field data is still always fetched live.
 */
export async function resolveEntity(name: string, module?: string): Promise<ResolvedEntity[]> {
  const normalized = normalize(name);
  if (!normalized) return [];

  const nameMatch = ilike(crmEntityIndex.searchTokens, `%${normalized}%`);
  const where = module ? and(eq(crmEntityIndex.module, module), nameMatch) : nameMatch;

  const rows = await db.select().from(crmEntityIndex).where(where).limit(5);

  return rows.map((r) => ({ zohoRecordId: r.zohoRecordId, module: r.module, displayName: r.displayName }));
}

export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
