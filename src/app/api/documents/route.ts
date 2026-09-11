import { desc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { enqueueIngestionJob } from "@/lib/ingestion/jobQueue";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const rows = await db.select().from(documents).orderBy(desc(documents.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json({ error: "A 'file' field is required" }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Only PDF files are supported" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "File exceeds the 20MB limit" }, { status: 400 });
  }

  const userId = session.user.id;
  const [doc] = await db
    .insert(documents)
    .values({ filename: file.name, status: "processing", uploadedBy: userId })
    .returning();

  const buffer = Buffer.from(await file.arrayBuffer());

  // Ingestion is queued, not run inline — a durable Postgres-backed worker
  // (src/lib/ingestion/jobQueue.ts, started in instrumentation.ts) picks it
  // up. Unlike the old fire-and-forget promise, this survives a server
  // restart mid-ingest and retries transient failures automatically.
  // Status polling (GET /api/documents) reflects processing -> ready/failed.
  await enqueueIngestionJob(doc!.id, buffer);

  return Response.json(doc, { status: 202 });
}
