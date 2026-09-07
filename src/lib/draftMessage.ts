import { getGemini, CHAT_MODEL } from "@/lib/gemini";

export interface OverdueInvoiceFacts {
  kind: "overdue_invoice";
  customerName: string;
  invoiceNumber: string;
  balance: string;
  currencyCode: string;
  dueDate: string;
}

export interface StaleDealFacts {
  kind: "stale_deal";
  dealName: string;
  stage: string;
  lastActivityDate: string;
  amount?: string;
}

export type DraftMessageFacts = OverdueInvoiceFacts | StaleDealFacts;

/**
 * Drafts a short, ready-to-copy follow-up message — never sent automatically.
 * This is deliberately a human-in-the-loop tool: it produces text for a
 * person to review, edit, and send themselves (WhatsApp, email, whatever),
 * not an action the system takes on its own. Given only the exact facts
 * already shown on screen, with an explicit instruction not to invent any
 * detail beyond them.
 */
export async function draftMessage(facts: DraftMessageFacts): Promise<string> {
  const instruction =
    facts.kind === "overdue_invoice"
      ? `Write a short, polite, professional payment reminder message (suitable for WhatsApp or email, 2-4 sentences, no subject line, no placeholders like [Your Name]) to send to a customer about an overdue invoice. Use ONLY these facts, do not invent any other detail:\n${JSON.stringify(facts)}`
      : `Write a short, warm, professional follow-up message (suitable for WhatsApp or email, 2-4 sentences, no subject line, no placeholders like [Your Name]) to re-engage a customer/prospect on a sales deal that has gone quiet. Use ONLY these facts, do not invent any other detail:\n${JSON.stringify(facts)}`;

  const res = await getGemini().models.generateContent({
    model: CHAT_MODEL,
    contents: [{ role: "user", parts: [{ text: instruction }] }],
  });

  const text = res.text?.trim();
  if (!text) throw new Error("Failed to draft a message");
  return text;
}
