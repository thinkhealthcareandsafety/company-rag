import { z } from "zod";
import { asc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(120).optional(),
});

// No roles system yet — any authenticated user can add a teammate. That
// matches the current trust model (everyone with a login is staff), and is
// the fix for "only one shared login exists": each person now gets their own
// account and their own private conversation history.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const [user] = await db
      .insert(users)
      .values({ email: parsed.data.email, passwordHash, name: parsed.data.name ?? null })
      .returning({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt });
    return Response.json(user, { status: 201 });
  } catch (err) {
    const message = err instanceof Error && /unique/i.test(err.message) ? `An account with email ${parsed.data.email} already exists` : "Failed to create account";
    return Response.json({ error: message }, { status: 409 });
  }
}
