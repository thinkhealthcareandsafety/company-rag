import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isRateLimited } from "@/lib/rateLimit";
import { runAgent } from "@/lib/agent/orchestrator";
import type { Content } from "@google/genai";

export const runtime = "nodejs";

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userKey = session.user.id ?? session.user.email ?? "anonymous";
  if (isRateLimited(userKey)) {
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

  // Gemini uses "model" rather than "assistant" for the assistant role.
  const history: Content[] = parsed.data.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for await (const event of runAgent(history)) {
          if (event.type === "token") send("token", { value: event.value });
          else if (event.type === "tool_call") send("tool_call", { name: event.name, args: event.args });
          else if (event.type === "tool_result") send("tool_result", { name: event.name, ok: event.ok });
          else if (event.type === "error") send("error", { message: event.message });
          else if (event.type === "done") send("done", {});
        }
      } catch (err) {
        // runAgent already converts its own failures into clean `error`
        // events; this only catches something unexpected outside that path.
        console.error("Unexpected error in chat stream:", err);
        send("error", { message: "Something went wrong generating a response. Please try again." });
      } finally {
        controller.close();
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
