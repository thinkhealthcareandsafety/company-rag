import { desc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { errorLogs } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const rows = await db
    .select()
    .from(errorLogs)
    .orderBy(desc(errorLogs.createdAt))
    .limit(100);

  return Response.json(rows);
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  await db.delete(errorLogs);
  return Response.json({ ok: true });
}
