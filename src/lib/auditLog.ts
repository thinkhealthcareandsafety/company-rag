import { db } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";

/**
 * Records "who accessed what, when" — a compliance record, not a debugging
 * aid (contrast with errorLog.ts, which is pruned to the last 500 rows: this
 * table is never trimmed). Called once per tool call from the agent
 * orchestrator, with a deliberately redacted `detail` — enough to answer an
 * audit question ("did anyone look up Apollo's invoices last week") without
 * duplicating full live CRM/Books/Inventory payloads into a second table.
 *
 * Never throws — a broken audit write must not take down the chat response
 * it was logging.
 */
export async function logAudit(entry: {
  userId: string | null;
  conversationId?: string | null;
  action: string;
  detail?: Record<string, unknown> | null;
  ok: boolean;
}) {
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId,
      conversationId: entry.conversationId ?? null,
      action: entry.action,
      detail: entry.detail ?? null,
      ok: entry.ok ? 1 : 0,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

/**
 * Reduces a tool call's raw args/result down to what an audit trail needs —
 * identifiers and counts, never full field values or document text. Kept
 * here (rather than inline in the orchestrator) so every call site redacts
 * the same way.
 */
export function summarizeToolCall(name: string, args: Record<string, unknown>, result: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (typeof args.module === "string") base.module = args.module;
  if (typeof args.record_id === "string") base.recordId = args.record_id;
  if (typeof args.name === "string") base.name = args.name;
  if (typeof args.query === "string") base.query = args.query;
  if (typeof args.coql === "string") base.coql = args.coql;
  if (typeof args.search_text === "string") base.searchText = args.search_text;

  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.records)) base.resultCount = r.records.length;
    if (Array.isArray(r.results)) base.resultCount = r.results.length;
    if (Array.isArray(r.items)) base.resultCount = r.items.length;
    if (Array.isArray((r.matches as unknown[] | undefined))) base.resultCount = (r.matches as unknown[]).length;
    if (r.record && typeof r.record === "object") base.recordId ??= (r.record as { id?: string }).id;
  }

  return base;
}
