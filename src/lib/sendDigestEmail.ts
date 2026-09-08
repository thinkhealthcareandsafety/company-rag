import { getDigestEmailEnv } from "@/lib/env";
import type { Digest } from "@/lib/digest";

/**
 * Sends the same Digest data shown on /digest as an email, via Resend's
 * plain REST API (no SDK — one fetch call, same pattern used for Zoho).
 * Best-effort: returns whether it sent rather than throwing, since a broken
 * email send shouldn't be treated as differently severe from any other
 * external-service hiccup by its caller.
 */
export async function sendDigestEmail(digest: Digest): Promise<{ sent: boolean; reason?: string }> {
  const env = getDigestEmailEnv();
  if (!env) return { sent: false, reason: "Email digest not configured (RESEND_API_KEY / DIGEST_EMAIL_TO unset)" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `think health <${env.DIGEST_EMAIL_FROM}>`,
      to: [env.DIGEST_EMAIL_TO],
      subject: `think health daily digest — ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
      html: renderDigestHtml(digest),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { sent: false, reason: `Resend request failed (${res.status}): ${body.slice(0, 300)}` };
  }
  return { sent: true };
}

function renderDigestHtml(digest: Digest): string {
  const row = (left: string, right: string) =>
    `<tr><td style="padding:8px 0;border-top:1px solid #eee;">${left}</td><td style="padding:8px 0;border-top:1px solid #eee;text-align:right;color:#d1453b;font-weight:600;">${right}</td></tr>`;

  const overdueRows =
    digest.overdueInvoices.items.length === 0
      ? `<p style="color:#888;margin:0.5rem 0;">No overdue invoices.</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:14px;">${digest.overdueInvoices.items
          .slice(0, 15)
          .map((inv) =>
            row(
              `${escapeHtml(String(inv.customerName ?? "Unknown"))}<br><span style="color:#888;font-size:12px;">Invoice ${escapeHtml(String(inv.invoiceNumber ?? ""))} · due ${escapeHtml(String(inv.dueDate ?? ""))}</span>`,
              `${escapeHtml(String(inv.currencyCode ?? ""))} ${escapeHtml(String(inv.balance ?? ""))}`,
            ),
          )
          .join("")}</table>${digest.overdueInvoices.items.length > 15 ? `<p style="color:#888;font-size:12px;">+ ${digest.overdueInvoices.items.length - 15} more — see the Digest page for the full list.</p>` : ""}`;

  const lowStockRows =
    digest.lowStockItems.length === 0
      ? `<p style="color:#888;margin:0.5rem 0;">No low-stock items.</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:14px;">${digest.lowStockItems
          .slice(0, 15)
          .map((item) =>
            row(
              `${escapeHtml(String(item.name ?? "Unknown"))}<br><span style="color:#888;font-size:12px;">SKU ${escapeHtml(String(item.sku ?? "—"))}</span>`,
              `${escapeHtml(String(item.stockOnHand ?? 0))} left`,
            ),
          )
          .join("")}</table>`;

  const staleDealRows =
    digest.staleDeals.length === 0
      ? `<p style="color:#888;margin:0.5rem 0;">No stale deals.</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:14px;">${digest.staleDeals
          .slice(0, 15)
          .map((deal) =>
            row(
              `${escapeHtml(String(deal.dealName ?? "Unnamed"))}<br><span style="color:#888;font-size:12px;">${escapeHtml(String(deal.stage ?? ""))} · since ${escapeHtml(String(deal.modifiedTime ?? "").slice(0, 10))}</span>`,
              deal.amount != null ? escapeHtml(String(deal.amount)) : "",
            ),
          )
          .join("")}</table>`;

  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#16151d;">
      <h1 style="font-size:20px;margin:0 0 4px;">think health — daily digest</h1>
      ${digest.narrative ? `<p style="font-size:15px;font-weight:600;border-left:3px solid #d94fa8;padding-left:12px;margin:16px 0;">${escapeHtml(digest.narrative)}</p>` : ""}
      <h2 style="font-size:15px;margin:24px 0 8px;">Overdue invoices (${digest.overdueInvoices.items.length})</h2>
      ${overdueRows}
      <h2 style="font-size:15px;margin:24px 0 8px;">Low stock (${digest.lowStockItems.length})</h2>
      ${lowStockRows}
      <h2 style="font-size:15px;margin:24px 0 8px;">Deals gone quiet (${digest.staleDeals.length})</h2>
      ${staleDealRows}
      <p style="color:#aaa;font-size:12px;margin-top:32px;">Generated ${new Date(digest.generatedAt).toLocaleString("en-IN")}</p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
