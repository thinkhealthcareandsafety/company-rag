"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TopNav } from "@/components/TopNav";
import { ChatSidebar } from "@/components/Chat/ChatSidebar";
import { PageLoader } from "@/components/Loader";
import { SendIcon } from "@/components/icons";

interface ToolActivity {
  name: string;
  ok?: boolean;
  result?: unknown;
}

interface DocumentSource {
  document?: string;
  page?: number;
  heading?: string;
  content?: string;
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

// Present tense while the call is in flight, past tense once it's resolved
// (success or failure — the chip's color/dot already carries that distinction)
// so a finished green chip doesn't still read as an ongoing action.
const TOOL_LABELS_PENDING: Record<string, string> = {
  search_documents: "Searching documents",
  lookup_crm_entity: "Resolving CRM record",
  get_crm_record: "Fetching live CRM record",
  query_crm_records: "Querying CRM",
  list_books_records: "Querying Zoho Books",
  get_books_record: "Fetching Books record",
  list_inventory_records: "Querying Zoho Inventory",
  get_inventory_record: "Fetching Inventory record",
  find_items_by_invoice_history: "Cross-referencing items and invoices",
};
const TOOL_LABELS_DONE: Record<string, string> = {
  search_documents: "Searched documents",
  lookup_crm_entity: "Resolved CRM record",
  get_crm_record: "Fetched live CRM record",
  query_crm_records: "Queried CRM",
  list_books_records: "Queried Zoho Books",
  get_books_record: "Fetched Books record",
  list_inventory_records: "Queried Zoho Inventory",
  get_inventory_record: "Fetched Inventory record",
  find_items_by_invoice_history: "Cross-referenced items and invoices",
};

const SAMPLE_QUESTIONS = ["What is our refund policy?", "Is JYOTHY LABS LIMITED one of our accounts?"];

// Navigating from "/" to "/c/<id>" after a brand-new conversation's first
// reply crosses a route boundary (different page.tsx files), so React
// unmounts this component and mounts a fresh instance — that instance would
// otherwise show a loading spinner and re-fetch from the DB messages it just
// finished streaming a moment ago, a jarring flash for something already in
// memory. This one-shot handoff lets the new instance pick up right where
// the old one left off instead. Module-level (not state) since it needs to
// survive the unmount/remount itself.
const conversationHandoff = new Map<string, Message[]>();

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
  // Starts closed on every render pass, server and client alike — a lazy
  // initializer reading window.innerWidth looks appealing, but window exists
  // during client hydration too, so it wouldn't just affect the initial
  // client render, it would make that render disagree with what the server
  // sent, which is exactly what a hydration mismatch is. Corrected safely in
  // an effect below, after hydration has already reconciled.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/shortcuts")
      .then((res) => (res.ok ? res.json() : []))
      .then(setShortcuts)
      .catch(() => {});
  }, []);

  // Layout effect (not a plain effect) so this resolves before the browser
  // paints — avoids a visible closed-then-open flash on desktop, while still
  // running only after hydration has already reconciled against the
  // server's "closed" markup, so it can't cause a mismatch.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.innerWidth >= 860) setSidebarOpen(true);
  }, []);

  // Callers key each <ChatPage> instance by conversation id (see page.tsx /
  // c/[id]/page.tsx), so a genuinely new conversation is a fresh mount with
  // fresh initial state — no reset-on-prop-change effect needed. This effect
  // only has to fetch the history for that one, fixed id.
  useEffect(() => {
    if (!initialConversationId) return;

    const handoff = conversationHandoff.get(initialConversationId);
    if (handoff) {
      // We just streamed this conversation's first reply in the previous
      // component instance a moment ago — reuse it instead of a redundant
      // fetch that would otherwise flash a loading spinner over content
      // already sitting right there.
      conversationHandoff.delete(initialConversationId);
      // One-time synchronous init for this mount (this component remounts
      // via `key={id}` per conversation, so this never re-runs mid-lifetime)
      // — equivalent to correcting a stale SSR-guessed initial value, not a
      // state reset tied to a changing prop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(handoff);
      setLoadingHistory(false);
      return;
    }

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

  async function send(text: string, options?: { regenerate?: boolean }) {
    const regenerate = options?.regenerate ?? false;
    if (busy) return;
    if (!regenerate && !text.trim()) return;

    setError(null);
    if (!regenerate) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }

    const wasNewConversation = !conversationId;
    let resolvedConversationId = conversationId;

    if (regenerate) {
      // Drop the previous assistant reply and re-run from the same history —
      // the server does the equivalent delete against its own copy.
      setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: "", tools: [] }]);
    } else {
      setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "", tools: [] }]);
    }
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regenerate ? { conversationId, regenerate: true } : { conversationId, message: text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "Request failed");
        throw new Error(body || `Request failed (${res.status})`);
      }

      await consumeSse(res.body, (event, data) => {
        if (event === "conversation") {
          resolvedConversationId = data.id as string;
          setConversationId(resolvedConversationId);
          // Warm the RSC cache for the URL we'll switch to once this reply
          // finishes streaming (still several seconds away). Without this,
          // router.replace() below has to wait on /c/[id]'s server-side
          // session check before it can render, and Next shows loading.tsx
          // (a full-screen skeleton) for that gap — visually indistinguishable
          // from a page reload. Prefetching now means that work is already
          // done by the time we actually navigate, so there's nothing left
          // to wait on and the skeleton never appears.
          if (wasNewConversation) router.prefetch(`/c/${resolvedConversationId}`);
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
              tools: (last.tools ?? []).map((t) =>
                t.name === data.name ? { ...t, ok: data.ok as boolean, result: data.result } : t,
              ),
            };
          } else if (event === "error") {
            setError(data.message as string);
          }
          return updated;
        });
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // user-initiated stop — leave whatever partial content already streamed in
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }

    // Defer the URL change until the response has fully streamed in — doing
    // it earlier would remount this page against `/c/<id>` mid-stream and
    // strand the in-flight reader in the unmounting component instance.
    if (wasNewConversation && resolvedConversationId) {
      // Read the latest messages synchronously via the updater callback —
      // the `messages` closure variable here is stale (captured at render
      // time), this is the reliable way to get the current value.
      setMessages((prev) => {
        conversationHandoff.set(resolvedConversationId!, prev);
        return prev;
      });
      router.replace(`/c/${resolvedConversationId}`, { scroll: false });
    }
  }

  function stop() {
    abortRef.current?.abort();
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
  // Covers two silent gaps, not just "no tools called yet": the model also
  // goes quiet for a real stretch after every tool has resolved but before
  // the synthesis call's first token arrives (a full extra round-trip to
  // Gemini) — that gap used to show nothing once a tool chip had appeared.
  const allToolsResolved = !lastMessage?.tools?.length || lastMessage.tools.every((t) => t.ok !== undefined);
  const isThinking = busy && lastMessage?.role === "assistant" && !lastMessage.content && allToolsResolved;

  return (
    <div className="chat-page-root-row">
      <ChatSidebar activeId={conversationId} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="chat-page-root">
        <TopNav onToggleSidebar={() => setSidebarOpen((o) => !o)} sidebarOpen={sidebarOpen} />
        <div className="chat-shell">
          {loadingHistory ? <PageLoader label="Loading conversation…" /> : messages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-mark">
                <img src="/logo.jpg" alt="think health" />
              </div>
              <h1>Welcome to think health AI</h1>
              <p>
                Ask about your policy documents, live Zoho CRM records, or Zoho Books data — or combine all three in
                one question.
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
                        <img src="/logo.jpg" alt="think health" />
                      </div>
                      <div className="chat-assistant-content">
                        {m.tools && m.tools.length > 0 && (
                          <div className="tool-chip-row">
                            {m.tools.map((t, idx) => {
                              const pending = t.ok === undefined;
                              const label = pending ? (TOOL_LABELS_PENDING[t.name] ?? t.name) : (TOOL_LABELS_DONE[t.name] ?? t.name);
                              return (
                                <span key={idx} className={`tool-chip ${t.ok === false ? "fail" : t.ok ? "ok" : ""}`}>
                                  {pending ? <span className="spin" /> : <span className="dot" />}
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {isThinking && i === messages.length - 1 ? (
                          <div className="typing-dots">
                            <span />
                            <span />
                            <span />
                          </div>
                        ) : (
                          <>
                            <div className="chat-markdown">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                            </div>
                            <SourceCitations tools={m.tools} />
                            {!busy && i === messages.length - 1 && m.content && (
                              <button type="button" className="regen-btn" onClick={() => send("", { regenerate: true })}>
                                ↻ Regenerate
                              </button>
                            )}
                          </>
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
              {busy ? (
                <button type="button" className="chat-send-btn chat-stop-btn" onClick={stop} aria-label="Stop generating">
                  <span className="stop-square" />
                </button>
              ) : (
                <button type="submit" className="chat-send-btn" disabled={!input.trim()} aria-label="Send">
                  <SendIcon />
                </button>
              )}
            </form>
            <p className="chat-hint">Answers may combine internal documents and live CRM data — verify anything critical.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceCitations({ tools }: { tools?: ToolActivity[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const docTool = tools?.find((t) => t.name === "search_documents" && t.ok && t.result);
  const payload = docTool?.result as { results?: DocumentSource[] } | undefined;
  const sources = Array.isArray(payload?.results) ? payload.results : [];
  if (sources.length === 0) return null;

  return (
    <div className="source-citations">
      {sources.map((s, i) => (
        <div key={i} className="source-citation">
          <button type="button" className="source-chip" onClick={() => setOpenIndex(openIndex === i ? null : i)}>
            📄 {s.document ?? "Document"}
            {s.page ? ` · p.${s.page}` : ""}
          </button>
          {openIndex === i && s.content && <div className="source-preview">{s.content}</div>}
        </div>
      ))}
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
