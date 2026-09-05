import { z } from "zod";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

/**
 * One-time bootstrap endpoint for creating the first login, for deployments
 * (Render's free tier, notably) that have no Shell/SSH access to run
 * `npm run user:create:prod` directly. Gated by the same shared secret as
 * /api/crm/sync — not user auth, since no user exists yet at bootstrap time.
 * Refuses once any user already exists, so a leaked secret can't be used to
 * keep minting accounts — it only ever bootstraps the very first one.
 */
export async function POST(req: Request) {
  const expected = process.env.CRM_SYNC_SECRET;
  const provided = req.headers.get("x-setup-secret");

  if (!expected || provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if ((row?.count ?? 0) > 0) {
    return Response.json({ error: "Setup already completed — a user already exists." }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const [user] = await db
    .insert(users)
    .values({ email: parsed.data.email.toLowerCase(), passwordHash, name: parsed.data.name ?? null })
    .returning({ id: users.id, email: users.email });

  return Response.json({ ok: true, user });
}
