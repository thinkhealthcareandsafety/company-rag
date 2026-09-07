import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { draftMessage, type DraftMessageFacts } from "@/lib/draftMessage";
import { logError } from "@/lib/errorLog";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("overdue_invoice"),
    customerName: z.string().min(1),
    invoiceNumber: z.string(),
    balance: z.string(),
    currencyCode: z.string(),
    dueDate: z.string(),
  }),
  z.object({
    kind: z.literal("stale_deal"),
    dealName: z.string().min(1),
    stage: z.string(),
    lastActivityDate: z.string(),
    amount: z.string().optional(),
  }),
]);

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // This only ever generates text for a human to review and send
    // themselves — nothing here has the ability to actually send anything.
    const message = await draftMessage(parsed.data as DraftMessageFacts);
    return Response.json({ message });
  } catch (err) {
    await logError(err, { source: "digest_draft_message" });
    return Response.json({ error: "Failed to draft a message" }, { status: 500 });
  }
}
