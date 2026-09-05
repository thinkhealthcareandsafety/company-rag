import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { crmEntityIndex } from "@/lib/db/schema";
import { listRecordsForSync, nameFieldFor } from "./zohoClient";
import { normalize } from "./entityResolution";

const MODULES = ["Accounts", "Contacts", "Deals"] as const;
const PAGE_SIZE = 200;

/**
 * Refreshes the local name -> Zoho record ID index. Deliberately syncs only
 * `id` and the display-name field for each module — never business data — so
 * this index can never itself become the source of a stale answer. Run on a
 * schedule (see scripts/sync-crm-entities.ts) independent of chat traffic.
 */
export async function syncCrmEntities(): Promise<{ module: string; count: number }[]> {
  const summary: { module: string; count: number }[] = [];

  for (const crmModule of MODULES) {
    let pageToken: string | undefined;
    let total = 0;
    const rows: (typeof crmEntityIndex.$inferInsert)[] = [];
    const nameField = nameFieldFor(crmModule);

    // Cursor-based: keep following next_page_token until Zoho reports no more records.
    while (true) {
      const { records, nextPageToken, moreRecords } = await listRecordsForSync(crmModule, pageToken, PAGE_SIZE);

      for (const record of records) {
        const displayName = String(record[nameField] ?? record.id);
        rows.push({
          zohoRecordId: String(record.id),
          module: crmModule,
          displayName,
          searchTokens: normalize(displayName),
        });
      }

      total += records.length;
      if (!moreRecords || !nextPageToken) break;
      pageToken = nextPageToken;
    }

    await db.transaction(async (tx) => {
      await tx.delete(crmEntityIndex).where(eq(crmEntityIndex.module, crmModule));
      if (rows.length > 0) {
        await tx.insert(crmEntityIndex).values(rows);
      }
    });

    summary.push({ module: crmModule, count: total });
  }

  return summary;
}
