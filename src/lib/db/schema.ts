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

export type User = typeof users.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type CrmEntity = typeof crmEntityIndex.$inferSelect;
export type PromptShortcut = typeof promptShortcuts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ErrorLog = typeof errorLogs.$inferSelect;
