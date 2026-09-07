import { eq, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  if (id === session.user.id) {
    return Response.json({ error: "You can't remove your own account while signed in as it." }, { status: 400 });
  }

  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if ((row?.count ?? 0) <= 1) {
    return Response.json({ error: "Can't remove the last remaining account." }, { status: 400 });
  }

  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!deleted) return new Response("Not found", { status: 404 });
  return Response.json({ ok: true });
}
