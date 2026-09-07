"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TopNav } from "@/components/TopNav";
import { ChatSidebar } from "@/components/Chat/ChatSidebar";
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

interface Shortcut {
  id: string;
  trigger: string;
  prompt: string;
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

export function ChatPage({ initialConversationId }: { initialConversationId?: string }) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(!!initialConversationId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Lazy-initialized from viewport width so desktop starts open and mobile
  // starts closed (an overlay drawer there) without a post-mount effect —
  // `window` is guarded for the SSR pass, which always renders "closed" and
  // is corrected the moment this client component actually mounts.
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 860);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/shortcuts")
      .then((res) => (res.ok ? res.json() : []))
      .then(setShortcuts)
      .catch(() => {});
  }, []);

  // Callers key each <ChatPage> instance by conversation id (see page.tsx /
  // c/[id]/page.tsx), so a genuinely new conversation is a fresh mount with
  // fresh initial state — no reset-on-prop-change effect needed. This effect
  // only has to fetch the history for that one, fixed id.
  useEffect(() => {
    if (!initialConversationId) return;
    fetch(`/api/conversations/${initialConversationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { messages: Message[] } | null) => {
        if (data) setMessages(data.messages);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [initialConversationId]);

  // Only offer shortcuts while the whole input is still a bare "/trigger" —
  // once a space is typed the user is writing a real message that happens to
  // start with "/", not picking a shortcut.
  const slashMatches = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    const query = input.slice(1).toLowerCase();
    return shortcuts.filter((s) => s.trigger.startsWith(query));
  }, [input, shortcuts]);

  async function send(text: string) {
    if (!text.trim() || busy) return;

    setError(null);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const wasNewConversation = !conversationId;
    let resolvedConversationId = conversationId;

    const nextMessages: Message[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "", tools: [] }];
    setMessages(nextMessages);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "Request failed");
        throw new Error(body || `Request failed (${res.status})`);
      }

      await consumeSse(res.body, (event, data) => {
        if (event === "conversation") {
          resolvedConversationId = data.id as string;
          setConversationId(resolvedConversationId);
          return;
        }

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

    // Defer the URL change until the response has fully streamed in — doing
    // it earlier would remount this page against `/c/<id>` mid-stream and
    // strand the in-flight reader in the unmounting component instance.
    if (wasNewConversation && resolvedConversationId) {
      router.replace(`/c/${resolvedConversationId}`, { scroll: false });
    }
  }

  function pickShortcut(shortcut: Shortcut) {
    setInput("");
    send(shortcut.prompt);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (slashMatches.length > 0) {
      pickShortcut(slashMatches[selectedIndex] ?? slashMatches[0]!);
      return;
    }
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (slashMatches.length > 0) {
        pickShortcut(slashMatches[selectedIndex] ?? slashMatches[0]!);
        return;
      }
      send(input);
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    setSelectedIndex(0);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  }

  const lastMessage = messages[messages.length - 1];
  const isThinking = busy && lastMessage?.role === "assistant" && !lastMessage.content && !lastMessage.tools?.length;

  return (
    <div className="chat-page-root-row">
      <ChatSidebar activeId={conversationId} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="chat-page-root">
        <TopNav onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        <div className="chat-shell">
          {loadingHistory ? null : messages.length === 0 ? (
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
            {slashMatches.length > 0 && (
              <div className="shortcut-dropdown">
                {slashMatches.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`shortcut-item ${i === selectedIndex ? "active" : ""}`}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => pickShortcut(s)}
                  >
                    <span className="shortcut-trigger">/{s.trigger}</span>
                    <span className="shortcut-preview">{s.prompt}</span>
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={handleSubmit} className="chat-composer">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={autoResize}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question, or type / for a saved shortcut…"
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
