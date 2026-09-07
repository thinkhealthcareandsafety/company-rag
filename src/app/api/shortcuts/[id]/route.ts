import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { promptShortcuts } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const [deleted] = await db.delete(promptShortcuts).where(eq(promptShortcuts.id, id)).returning();

  if (!deleted) return new Response("Not found", { status: 404 });
  return Response.json({ ok: true });
}
