import { customType } from "drizzle-orm/pg-core";
import { pgTable, uuid, text, integer, timestamp, jsonb, varchar, index } from "drizzle-orm/pg-core";

const EMBEDDING_DIMENSIONS = 768; // gemini-embedding-001 with outputDimensionality: 768

/**
 * pgvector column. Drizzle has no first-class `vector` type, so we round-trip
 * through pgvector's text literal format "[0.1,0.2,...]" and let a raw SQL
 * cast (see retrieval/vectorSearch.ts) do the actual similarity math.
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map(Number);
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("processing"), // processing | ready | failed
  failureReason: text("failure_reason"),
  version: integer("version").notNull().default(1),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding").notNull(),
    // { page?: number, heading?: string }
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("document_chunks_document_id_idx").on(table.documentId)],
);

export const crmEntityIndex = pgTable(
  "crm_entity_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zohoRecordId: varchar("zoho_record_id", { length: 64 }).notNull(),
    module: varchar("module", { length: 40 }).notNull(), // Contacts | Accounts | Deals
    displayName: text("display_name").notNull(),
    searchTokens: text("search_tokens").notNull(), // lowercased, normalized displayName for fuzzy matching
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("crm_entity_index_search_tokens_idx").on(table.searchTokens)],
);

export const promptShortcuts = pgTable("prompt_shortcuts", {
  id: uuid("id").primaryKey().defaultRandom(),
  trigger: varchar("trigger", { length: 40 }).notNull().unique(), // stored lowercase, no leading slash
  prompt: text("prompt").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("conversations_user_id_idx").on(table.userId)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(), // user | assistant
    content: text("content").notNull(),
    // Assistant messages only: [{ name, ok }] — which tools ran, for redisplay on reload.
    tools: jsonb("tools"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_messages_conversation_id_idx").on(table.conversationId)],
);

export const errorLogs = pgTable(
  "error_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    message: text("message").notNull(),
    stack: text("stack"),
    // Free-form: { route?, userId?, conversationId? } — whatever the call site knew.
    context: jsonb("context"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("error_logs_created_at_idx").on(table.createdAt)],
);

/**
 * Durable ingestion queue: a document upload inserts one row here instead of
 * firing ingestDocument() directly. A worker (see ingestion/jobQueue.ts,
 * started from instrumentation.ts) claims rows with SKIP LOCKED so a server
 * restart mid-ingest can never lose or duplicate work — the previous
 * fire-and-forget promise dropped the job silently on restart.
 */
export const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // The uploaded PDF's bytes, kept only until the job finishes (cleared on
    // success) — this is what makes ingestion durable across a restart
    // without adding an object-storage dependency. Move this to real object
    // storage before high-volume/enterprise use (see README).
    fileBytes: customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" })("file_bytes"),
    status: varchar("status", { length: 20 }).notNull().default("queued"), // queued | processing | done | failed
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ingestion_jobs_status_next_attempt_idx").on(table.status, table.nextAttemptAt)],
);

/**
 * Who looked at what, and when. Separate from error_logs (a debugging aid
 * that's pruned to the last 500 rows) — this is a compliance record and is
 * never trimmed. Every tool call the agent makes is logged here with a
 * redacted summary of what was accessed (module + record id, not full field
 * values), so "who asked about invoice X" is always answerable without
 * duplicating live customer data into a second table.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    action: varchar("action", { length: 60 }).notNull(), // tool name, e.g. get_books_record
    // { module?, recordId?, query?, resultCount? } — enough to answer "what
    // was accessed", deliberately not the full tool result payload.
    detail: jsonb("detail"),
    ok: integer("ok").notNull().default(1), // 1 = succeeded, 0 = the tool call errored
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_user_id_idx").on(table.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type CrmEntity = typeof crmEntityIndex.$inferSelect;
export type PromptShortcut = typeof promptShortcuts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ErrorLog = typeof errorLogs.$inferSelect;
export type IngestionJob = typeof ingestionJobs.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
