import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isRateLimited } from "@/lib/rateLimit";
import { logError } from "@/lib/errorLog";
import { runAgent } from "@/lib/agent/orchestrator";
import { db } from "@/lib/db/client";
import { conversations, chatMessages } from "@/lib/db/schema";
import type { Content } from "@google/genai";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1).max(8000).optional(),
    regenerate: z.boolean().optional(),
  })
  .refine((data) => data.regenerate || data.message, { message: "message is required unless regenerating" });

const TITLE_MAX_LENGTH = 60;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  const userKey = userId ?? session.user.email ?? "anonymous";
  if (await isRateLimited(userKey)) {
    return new Response("Rate limit exceeded — please slow down.", { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { message, regenerate } = parsed.data;
  let conversationId = parsed.data.conversationId;
  let history: Content[] = [];

  if (regenerate) {
    if (!conversationId) return Response.json({ error: "Cannot regenerate without a conversation" }, { status: 400 });

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
    if (!conversation) return new Response("Conversation not found", { status: 404 });

    const allMessages = await db
      .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.createdAt));

    const lastAssistantIndex = allMessages.map((m) => m.role).lastIndexOf("assistant");
    if (lastAssistantIndex === -1) {
      return Response.json({ error: "Nothing to regenerate yet" }, { status: 400 });
    }

    await db.delete(chatMessages).where(eq(chatMessages.id, allMessages[lastAssistantIndex]!.id));
    history = allMessages.slice(0, lastAssistantIndex).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  } else {
    // Resolve (or create) the conversation server-side, and load its prior
    // history from Postgres — the client only ever sends the new message,
    // not the whole transcript, so this is the single source of truth.
    if (conversationId) {
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
      if (!conversation) return new Response("Conversation not found", { status: 404 });

      const priorMessages = await db
        .select({ role: chatMessages.role, content: chatMessages.content })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
        .orderBy(asc(chatMessages.createdAt));

      history = priorMessages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    } else {
      const title = message!.length > TITLE_MAX_LENGTH ? `${message!.slice(0, TITLE_MAX_LENGTH)}…` : message!;
      const [conversation] = await db.insert(conversations).values({ userId, title }).returning();
      conversationId = conversation!.id;
    }

    await db.insert(chatMessages).values({ conversationId, role: "user", content: message! });
    history.push({ role: "user", parts: [{ text: message! }] });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // If the client disconnects mid-stream, enqueue() throws — that's not
      // an application error, just nothing left to stream to. Swallow it so
      // it can never abort the agent loop or skip persisting the message.
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client gone; agent loop and DB persistence below continue regardless
        }
      };

      send("conversation", { id: conversationId });

      let fullContent = "";
      const toolActivity: { name: string; ok?: boolean; result?: unknown }[] = [];

      try {
        for await (const event of runAgent(history)) {
          if (event.type === "token") {
            fullContent += event.value;
            send("token", { value: event.value });
          } else if (event.type === "tool_call") {
            toolActivity.push({ name: event.name });
            send("tool_call", { name: event.name, args: event.args });
          } else if (event.type === "tool_result") {
            const entry = toolActivity.find((t) => t.name === event.name && t.ok === undefined);
            if (entry) {
              entry.ok = event.ok;
              entry.result = event.result;
            }
            // Only search_documents' result is useful client-side (citation
            // preview) — CRM/Books payloads can carry live customer data we
            // don't want sitting in the browser any longer than necessary.
            send("tool_result", { name: event.name, ok: event.ok, result: event.name === "search_documents" ? event.result : undefined });
          } else if (event.type === "error") {
            send("error", { message: event.message });
          } else if (event.type === "done") {
            send("done", {});
          }
        }
      } catch (err) {
        await logError(err, { source: "chat_route", conversationId });
        send("error", { message: "Something went wrong generating a response. Please try again." });
      } finally {
        if (fullContent) {
          await db.insert(chatMessages).values({
            conversationId,
            role: "assistant",
            content: fullContent,
            tools: toolActivity.length > 0 ? toolActivity : null,
          });
        }
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId!));
        try {
          controller.close();
        } catch {
          // already closed (e.g. client disconnected) — nothing to do
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Silence an unused-import lint if `desc` ends up unused after edits — kept
// imported for symmetry with other list queries in this codebase.
void desc;
