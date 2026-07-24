import { randomUUID } from "crypto";
import { odooCall } from "./odoo-core.js";

const ODOO_URL = process.env.ODOO_URL;

const INVOICE_FIELDS = [
  "id", "name", "move_type", "state", "payment_state",
  "invoice_date", "invoice_date_due",
  "amount_untaxed", "amount_tax", "amount_total", "amount_residual",
  "partner_id", "invoice_line_ids", "access_token",
];

export async function getInvoicesByPartner(partnerId, companyPartnerId) {
  const partnerIds = companyPartnerId && companyPartnerId !== partnerId
    ? [partnerId, companyPartnerId]
    : [partnerId];

  const invoices = await odooCall("account.move", "search_read",
    [[
      ["partner_id", "in", partnerIds],
      ["move_type", "=", "out_invoice"],
      ["state", "=", "posted"],
    ]],
    {
      fields: INVOICE_FIELDS,
      order: "invoice_date desc",
      limit: 50,
    }
  );
  return (invoices || []).map(mapInvoice);
}

export async function getInvoiceForPartner(invoiceId, partnerId) {
  const invoices = await odooCall("account.move", "search_read",
    [[
      ["id", "=", invoiceId],
      ["partner_id", "=", partnerId],
      ["move_type", "=", "out_invoice"],
    ]],
    { fields: INVOICE_FIELDS, limit: 1 }
  );
  return invoices?.[0] ? mapInvoice(invoices[0]) : null;
}

export async function getOrderForPartner(orderId, partnerId, companyPartnerId) {
  const partnerIds = companyPartnerId && companyPartnerId !== partnerId
    ? [partnerId, companyPartnerId]
    : [partnerId];
  const orders = await odooCall("sale.order", "search_read",
    [[["id", "=", orderId], ["partner_id", "in", partnerIds]]],
    { fields: ["id", "name", "access_token", "partner_id"], limit: 1 }
  );
  return orders?.[0] || null;
}

// Ensure a record has an access_token; generate and write one if missing
export async function ensureAccessToken(model, recordId) {
  const [record] = await odooCall(model, "read", [[recordId]], { fields: ["access_token"] });
  if (record?.access_token) return record.access_token;
  const token = randomUUID().replace(/-/g, "");
  await odooCall(model, "write", [[recordId], { access_token: token }]);
  return token;
}

// Fetch Odoo PDF as a Buffer (for email attachments)
export async function fetchOdooPdfBuffer(odooReportUrl) {
  const pdfRes = await fetch(odooReportUrl, {
    headers: { "User-Agent": "b2b-smalto-api/1.0" },
  });
  if (!pdfRes.ok) throw new Error(`PDF fetch failed: ${pdfRes.status}`);
  const ab = await pdfRes.arrayBuffer();
  return Buffer.from(ab);
}

// Proxy Odoo PDF through our API
export async function proxyOdooPdf(res, odooReportUrl, filename) {
  const pdfRes = await fetch(odooReportUrl, {
    headers: { "User-Agent": "b2b-smalto-api/1.0" },
  });

  if (!pdfRes.ok) {
    return res.status(502).json({ error: "Erreur génération PDF Odoo" });
  }

  const contentType = pdfRes.headers.get("content-type") || "application/pdf";
  res.set({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  });

  const buffer = await pdfRes.arrayBuffer();
  res.end(Buffer.from(buffer));
}

function mapInvoice(inv) {
  return {
    id: inv.id,
    number: inv.name,
    state: inv.state,
    payment_state: inv.payment_state,
    payment_label: mapPaymentState(inv.payment_state),
    date: inv.invoice_date,
    due_date: inv.invoice_date_due,
    amount_untaxed: inv.amount_untaxed,
    amount_tax: inv.amount_tax,
    amount_total: inv.amount_total,
    amount_residual: inv.amount_residual,
    currency: "EUR",
    is_overdue: inv.invoice_date_due
      ? new Date(inv.invoice_date_due) < new Date() && inv.payment_state !== "paid"
      : false,
  };
}

function mapPaymentState(state) {
  const map = {
    not_paid: "Non réglée",
    partial: "Partiellement réglée",
    paid: "Réglée",
    in_payment: "En cours de règlement",
    reversed: "Annulée",
  };
  return map[state] || state;
}
