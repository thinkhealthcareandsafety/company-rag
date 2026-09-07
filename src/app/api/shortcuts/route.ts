import { z } from "zod";
import { asc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { promptShortcuts } from "@/lib/db/schema";

export const runtime = "nodejs";

const createSchema = z.object({
  trigger: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, - and _ allowed")
    .transform((s) => s.toLowerCase()),
  prompt: z.string().trim().min(1).max(2000),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const rows = await db.select().from(promptShortcuts).orderBy(asc(promptShortcuts.trigger));
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

  try {
    const [row] = await db
      .insert(promptShortcuts)
      .values({ trigger: parsed.data.trigger, prompt: parsed.data.prompt, createdBy: session.user.id })
      .returning();
    return Response.json(row, { status: 201 });
  } catch (err) {
    // Unique constraint on `trigger` — surface a clean message rather than a raw DB error.
    const message = err instanceof Error && /unique/i.test(err.message) ? `Shortcut "/${parsed.data.trigger}" already exists` : "Failed to create shortcut";
    return Response.json({ error: message }, { status: 409 });
  }
}
