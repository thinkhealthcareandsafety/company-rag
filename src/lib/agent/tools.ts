import { Type, type FunctionDeclaration } from "@google/genai";
import { searchDocuments } from "@/lib/retrieval/vectorSearch";
import { resolveEntity } from "@/lib/crm/entityResolution";
import { getRecord, queryRecords, ZohoApiError } from "@/lib/crm/zohoClient";
import { listBooksRecords, getBooksRecord, countInvoicesByItem, BOOKS_MODULES } from "@/lib/crm/zohoBooksClient";
import { listInventoryRecords, getInventoryRecord, INVENTORY_MODULES } from "@/lib/crm/zohoInventoryClient";

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "search_documents",
    description:
      "Semantic search over ingested unstructured documents (policies, PDFs). Returns the most relevant passages with source citations. Use for questions about internal documentation, policies, or procedures.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Natural-language search query" },
        top_k: { type: Type.INTEGER, description: "Number of passages to return (default 6)" },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_crm_entity",
    description:
      "Resolves a customer/account/contact/deal name mentioned in the user's question to a Zoho CRM record ID. Call this BEFORE get_crm_record when you only have a name, not an ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "The customer/account/contact/deal name to resolve" },
        module: { type: Type.STRING, enum: ["Accounts", "Contacts", "Deals"], description: "Restrict the search to one CRM module, if known" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_crm_record",
    description:
      "Fetches a single live CRM record by its Zoho record ID (from lookup_crm_entity). Always returns current, real-time data — never cached.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: { type: Type.STRING, enum: ["Accounts", "Contacts", "Deals"] },
        record_id: { type: Type.STRING },
        fields: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Optional specific field API names to fetch" },
      },
      required: ["module", "record_id"],
    },
  },
  {
    name: "query_crm_records",
    description:
      "Runs a live Zoho COQL query for filtered/aggregate customer questions (e.g. 'accounts with no activity in 30 days', 'deals over $10k'). Provide a valid COQL select statement. Zoho caps results at 200 rows per call regardless of LIMIT — the response's moreRecords flag tells you if more exist. If a numeric 'Amount' field was selected, amountSum is an exact server-computed total over the rows returned; quote it directly instead of adding amounts yourself.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: { type: Type.STRING, enum: ["Accounts", "Contacts", "Deals"] },
        coql: {
          type: Type.STRING,
          description:
            "A COQL SELECT statement. Zoho COQL always REQUIRES a where clause, even for an unfiltered listing — use \"where id is not null\" if there's no real filter, e.g. \"select id, Deal_Name, Amount, Closing_Date from Deals where id is not null order by Closing_Date desc limit 10\". For a real filter: \"select id, Account_Name from Accounts where Industry = 'Healthcare' limit 10\".",
        },
      },
      required: ["module", "coql"],
    },
  },
  {
    name: "list_books_records",
    description:
      "Lists/filters live Zoho Books records — invoices, estimates, bills, expenses, sales orders, purchase orders, customer/vendor payments, credit/debit notes, contacts (customers/vendors), or projects. Use for financial/accounting questions (e.g. 'unpaid invoices', 'expenses this month', 'overdue bills'). The response includes an amountSummary (exact server-computed sum per currency) — for any total/sum question, quote that number directly rather than adding up individual record amounts yourself.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: { type: Type.STRING, enum: BOOKS_MODULES },
        filters: {
          type: Type.OBJECT,
          description:
            "Optional Zoho Books filter query params for this module, e.g. {\"status\": \"unpaid\"} for invoices/bills, {\"date_start\": \"2026-01-01\", \"date_end\": \"2026-01-31\"} for expenses. Omit for an unfiltered recent listing.",
          properties: {},
        },
      },
      required: ["module"],
    },
  },
  {
    name: "get_books_record",
    description: "Fetches a single live Zoho Books record by its ID (e.g. a specific invoice or bill) once you know the ID from list_books_records.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: { type: Type.STRING, enum: BOOKS_MODULES },
        record_id: { type: Type.STRING },
      },
      required: ["module", "record_id"],
    },
  },
  {
    name: "list_inventory_records",
    description:
      "Lists/filters live Zoho Inventory items, composite items, or warehouses. Use for stock/catalog questions (e.g. 'how much stock of X do we have', 'which items are low on stock', 'list our warehouses'). For invoices, orders, bills, or payments use list_books_records instead — Inventory only adds stock/catalog data here.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: { type: Type.STRING, enum: INVENTORY_MODULES },
        filters: {
          type: Type.OBJECT,
          description:
            "Optional Zoho Inventory filter query params for this module, e.g. {\"search_text\": \"widget\"} or {\"filter_by\": \"Status.LowStock\"} for items. Omit for an unfiltered listing.",
          properties: {},
        },
      },
      required: ["module"],
    },
  },
  {
    name: "get_inventory_record",
    description: "Fetches a single live Zoho Inventory record by its ID (e.g. a specific item) once you know the ID from list_inventory_records.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: { type: Type.STRING, enum: INVENTORY_MODULES },
        record_id: { type: Type.STRING },
      },
      required: ["module", "record_id"],
    },
  },
  {
    name: "find_items_by_invoice_history",
    description:
      "Cross-references the Zoho Inventory item catalog against Zoho Books invoice history — use for questions combining item status with whether/how many times an item has been invoiced (e.g. 'active items with at least one invoice', 'items that have never been billed', 'how many invoices does each item have'). The response includes an exact invoiceCount per matched item — quote it directly, don't guess or recount. ALWAYS narrow with search_text when the question mentions a name/keyword (e.g. 'AED' items) — this is checked item-by-item, so an unfiltered catalog scan is far slower than it needs to be. Omit invoice_presence to get every checked item's count in ONE call and derive both 'has' and 'no invoice' groups yourself from that — calling this twice (once per direction) for the same question wastes an entire redundant catalog scan. This is still slower than other tools (checks items one by one) — only use it when the question genuinely needs this cross-reference.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        item_status: { type: Type.STRING, enum: ["active", "inactive", "all"], description: "Defaults to active" },
        search_text: { type: Type.STRING, description: "Narrow to items whose name/SKU matches this text before checking invoices — always set this when the question names or implies a specific item, category, or keyword" },
        invoice_presence: {
          type: Type.STRING,
          enum: ["has_invoice", "no_invoice"],
          description: "Optional — restrict to items that DO or DON'T have at least one invoice. Omit to get every item's count in one call instead of needing two.",
        },
      },
      required: [],
    },
  },
];

/**
 * Executes one tool call. Never throws — a failure becomes a structured
 * error payload fed back to the model so the agentic loop can degrade
 * gracefully (answer from what succeeded, or tell the user what's
 * unavailable) instead of the whole request 500-ing.
 */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case "search_documents": {
        const results = await searchDocuments(args.query as string, (args.top_k as number) ?? 6);
        return {
          source: "vector_database",
          results: results.map((r) => ({
            document: r.filename,
            page: r.page,
            heading: r.heading,
            similarity: Number(r.similarity.toFixed(3)),
            content: r.content,
          })),
        };
      }
      case "lookup_crm_entity": {
        const matches = await resolveEntity(args.name as string, args.module as string | undefined);
        return { source: "crm_entity_index", matches };
      }
      case "get_crm_record": {
        const record = await getRecord(args.module as string, args.record_id as string, args.fields as string[] | undefined);
        return { source: "zoho_crm_live", record };
      }
      case "query_crm_records": {
        const { records, moreRecords, amountSum } = await queryRecords(args.module as string, args.coql as string);
        return { source: "zoho_crm_live", records, moreRecords, amountSum };
      }
      case "list_books_records": {
        const { records, hasMorePage, amountSummary } = await listBooksRecords(
          args.module as string,
          (args.filters as Record<string, string> | undefined) ?? {},
        );
        return { source: "zoho_books_live", records, hasMorePage, amountSummary };
      }
      case "get_books_record": {
        const record = await getBooksRecord(args.module as string, args.record_id as string);
        return { source: "zoho_books_live", record };
      }
      case "list_inventory_records": {
        const { records, hasMorePage } = await listInventoryRecords(
          args.module as string,
          (args.filters as Record<string, string> | undefined) ?? {},
        );
        return { source: "zoho_inventory_live", records, hasMorePage };
      }
      case "get_inventory_record": {
        const record = await getInventoryRecord(args.module as string, args.record_id as string);
        return { source: "zoho_inventory_live", record };
      }
      case "find_items_by_invoice_history": {
        // Bounded so this always finishes within the tool-call timeout —
        // see the identical reasoning in zohoBooksClient.ts on why this is
        // an item-by-item check rather than one bulk report call.
        const MAX_ITEMS_TO_CHECK = 300;

        const itemStatus = (args.item_status as string) ?? "active";
        const invoicePresence = args.invoice_presence as "has_invoice" | "no_invoice" | undefined;
        const filters: Record<string, string> = itemStatus === "all" ? {} : { status: itemStatus };
        if (typeof args.search_text === "string" && args.search_text.trim()) {
          filters.search_text = args.search_text.trim();
        }

        const { records } = await listInventoryRecords("items", filters);
        const truncated = records.length > MAX_ITEMS_TO_CHECK;
        const toCheck = records.slice(0, MAX_ITEMS_TO_CHECK);

        const invoiceCounts = await countInvoicesByItem(toCheck.map((r) => r.id));
        const matched = toCheck.filter((r) => {
          if (!invoicePresence) return true; // no filter — return every checked item's count
          const count = invoiceCounts.get(r.id)?.count ?? 0;
          return invoicePresence === "has_invoice" ? count > 0 : count === 0;
        });

        return {
          source: "zoho_cross_reference",
          items: matched.map((r) => {
            const info = invoiceCounts.get(r.id);
            return {
              id: r.id,
              name: r.name,
              sku: r.sku,
              status: r.status,
              invoiceCount: info?.atLeast ? `${info.count}+` : (info?.count ?? 0),
            };
          }),
          totalItemsChecked: toCheck.length,
          truncated, // true means more matching items may exist beyond what was checked — say so, don't imply completeness
        };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof ZohoApiError ? err.message : err instanceof Error ? err.message : "Unknown tool error";
    return { error: message };
  }
}
