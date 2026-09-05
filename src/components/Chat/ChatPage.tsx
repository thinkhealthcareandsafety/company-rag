"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TopNav } from "@/components/TopNav";
import { SparkIcon, SendIcon } from "@/components/icons";

interface ToolActivity {
  name: string;
  ok?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tools?: ToolActivity[];
}

const TOOL_LABELS: Record<string, string> = {
  search_documents: "Searching documents",
  lookup_crm_entity: "Resolving CRM record",
  get_crm_record: "Fetching live CRM record",
  query_crm_records: "Querying CRM",
  list_books_records: "Querying Zoho Books",
  get_books_record: "Fetching Books record",
};

const SAMPLE_QUESTIONS = ["What is our refund policy?", "Is JYOTHY LABS LIMITED one of our accounts?"];

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    if (!text.trim() || busy) return;

    setError(null);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const nextMessages: Message[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "", tools: [] }];
    setMessages(nextMessages);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "Request failed");
        throw new Error(body || `Request failed (${res.status})`);
      }

      await consumeSse(res.body, (event, data) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1]!;

          if (event === "token") {
            updated[updated.length - 1] = { ...last, content: last.content + (data.value as string) };
          } else if (event === "tool_call") {
            updated[updated.length - 1] = { ...last, tools: [...(last.tools ?? []), { name: data.name as string }] };
          } else if (event === "tool_result") {
            updated[updated.length - 1] = {
              ...last,
              tools: (last.tools ?? []).map((t) => (t.name === data.name ? { ...t, ok: data.ok as boolean } : t)),
            };
          } else if (event === "error") {
            setError(data.message as string);
          }
          return updated;
        });
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  }

  const lastMessage = messages[messages.length - 1];
  const isThinking = busy && lastMessage?.role === "assistant" && !lastMessage.content && !lastMessage.tools?.length;

  return (
    <div className="chat-page-root">
      <TopNav />
      <div className="chat-shell">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-mark">
              <SparkIcon />
            </div>
            <h1>Ask about your documents or live CRM data</h1>
            <p>
              Questions can pull from ingested policy documents, live Zoho CRM records, or both combined into one
              answer.
            </p>
            <div className="chat-suggestions">
              {SAMPLE_QUESTIONS.map((q) => (
                <button key={q} type="button" className="suggestion-chip" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-scroll">
            <div className="chat-column">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="chat-row user">
                    <div className="chat-bubble-user">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="chat-row">
                    <div className="chat-avatar">
                      <SparkIcon />
                    </div>
                    <div className="chat-assistant-content">
                      {m.tools && m.tools.length > 0 && (
                        <div className="tool-chip-row">
                          {m.tools.map((t, idx) => (
                            <span key={idx} className={`tool-chip ${t.ok === false ? "fail" : t.ok ? "ok" : ""}`}>
                              {t.ok === undefined ? <span className="spin" /> : <span className="dot" />}
                              {TOOL_LABELS[t.name] ?? t.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {isThinking && i === messages.length - 1 ? (
                        <div className="typing-dots">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : (
                        <div className="chat-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
              {error && <p className="error-text">{error}</p>}
              <div ref={bottomRef} />
            </div>
          </div>
        )}

        <div className="chat-composer-wrap">
          <form onSubmit={handleSubmit} className="chat-composer">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={autoResize}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question…"
              disabled={busy}
              rows={1}
            />
            <button type="submit" className="chat-send-btn" disabled={busy || !input.trim()} aria-label="Send">
              <SendIcon />
            </button>
          </form>
          <p className="chat-hint">Answers may combine internal documents and live CRM data — verify anything critical.</p>
        </div>
      </div>
    </div>
  );
}

async function consumeSse(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: Record<string, unknown>) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const eventLine = chunk.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.replace("event:", "").trim();
      const data = JSON.parse(dataLine.replace("data:", "").trim());
      onEvent(event, data);
    }
  }
}
