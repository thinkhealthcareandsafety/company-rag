import { buildDigest } from "@/lib/digest";
import { sendDigestEmail } from "@/lib/sendDigestEmail";
import { logError } from "@/lib/errorLog";

export const runtime = "nodejs";

/**
 * Cron-callable endpoint that emails the current Digest. Protected by a
 * shared secret header (not user auth), same pattern as /api/crm/sync — an
 * external scheduler (cron-job.org, EasyCron, GitHub Actions, ...) hits this
 * once a day, no logged-in session needed.
 */
export async function POST(req: Request) {
  const expected = process.env.DIGEST_EMAIL_SECRET;
  const provided = req.headers.get("x-digest-email-secret");

  if (!expected || provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const digest = await buildDigest(true); // always fresh for a scheduled send, never the 2-minute UI cache
    const result = await sendDigestEmail(digest);
    if (!result.sent) return Response.json({ ok: false, error: result.reason }, { status: 502 });
    return Response.json({ ok: true });
  } catch (err) {
    await logError(err, { source: "digest_email_route" });
    return Response.json({ ok: false, error: "Failed to build or send the digest email" }, { status: 500 });
  }
}
