import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildDigest } from "@/lib/digest";
import { logError } from "@/lib/errorLog";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";

  try {
    const digest = await buildDigest(forceRefresh);
    return Response.json(digest);
  } catch (err) {
    await logError(err, { source: "digest_route" });
    return new Response("Failed to build digest", { status: 500 });
  }
}
