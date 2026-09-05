import { syncCrmEntities } from "@/lib/crm/syncEntities";

export const runtime = "nodejs";

/**
 * Cron-callable endpoint that refreshes the CRM name->ID index. Protected by
 * a shared secret header (not user auth) so an external scheduler can call it
 * without a logged-in session, while still keeping it off the open internet.
 * Read directly from process.env (not the getXEnv() helpers in @/lib/env) since
 * this is an app-level toggle, not a subsystem credential — it's fine for the
 * whole route to no-op with a 401 when unset, rather than failing module load.
 */
export async function POST(req: Request) {
  const expected = process.env.CRM_SYNC_SECRET;
  const provided = req.headers.get("x-crm-sync-secret");

  if (!expected || provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await syncCrmEntities();
    return Response.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
