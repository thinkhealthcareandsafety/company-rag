import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildDigest } from "@/lib/digest";
import { getDigestEmailEnv } from "@/lib/env";
import { logError } from "@/lib/errorLog";

export const runtime = "nodejs";

/**
 * Streams real progress as each of the three live Zoho checks (and the
 * final AI summary) completes, rather than the client just staring at a
 * spinner for the few seconds a fresh (non-cached) build takes. A cached
 * response still comes back over this same stream — just as one immediate
 * 100% "Loaded from cache" progress event followed by the data.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client disconnected — nothing left to stream to
        }
      };

      try {
        const digest = await buildDigest(forceRefresh, (percent, label) => send("progress", { percent, label }));
        send("done", { ...digest, emailDigestConfigured: getDigestEmailEnv() !== undefined });
      } catch (err) {
        await logError(err, { source: "digest_route" });
        // Named "fail", not "error" — EventSource treats "error" as its own
        // reserved connection-failure event on the client, so reusing that
        // name here would be ambiguous with an actual dropped connection.
        send("fail", { message: "Failed to build digest" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
