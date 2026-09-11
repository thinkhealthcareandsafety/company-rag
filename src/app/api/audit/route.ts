import { desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { auditLogs, users } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Every signed-in user can read the audit trail today — same visibility
 * model as the Errors page, since this app has no role system yet (see
 * README "Not built yet"). Add an admin-only role check here first if that
 * changes; an audit log that anyone can also read is weaker than one gated
 * to the people who need it.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      detail: auditLogs.detail,
      ok: auditLogs.ok,
      createdAt: auditLogs.createdAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);

  return Response.json(rows);
}
