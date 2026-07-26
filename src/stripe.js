import Stripe from "stripe";
import { odooCall } from "./odoo-core.js";
import { fetchOdooPdfBuffer } from "./invoices.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

// sendEmail/emailOrderConfirmation are injected because each app's email.js
// carries its own app-specific templates alongside these shared helpers.
// `orderEmailSource` tags the confirmation email sent from the webhook (ex:
// "B2B-COMMANDE" / "B2C-COMMANDE") so it's identifiable in digital@smalto.fr.
export function createStripeHandlers({ sendEmail, emailOrderConfirmation, orderEmailSource = null }) {
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
  const ODOO_URL = process.env.ODOO_URL;

  // ── Create Stripe Checkout session ───────────────────────────────────────
  async function createCheckoutSession({ odooOrderId, orderNumber, items, shippingCost, partnerId, email, depositPercent }) {
    const lineItems = items.map(item => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: item.name,
          ...(item.image_url ? { images: [item.image_url] } : {}),
        },
        unit_amount: Math.round(item.unit_price * 100), // cents HT
      },
      quantity: item.quantity,
    }));

    if (shippingCost > 0) {
      lineItems.push({
        price_data: {
          currency: "eur",
          product_data: { name: "Frais de livraison" },
          unit_amount: Math.round(shippingCost * 100),
        },
        quantity: 1,
      });
    }

    // Acompte: reduce all amounts by depositPercent
    const isDeposit = depositPercent > 0 && depositPercent < 100;
    const finalLineItems = isDeposit
      ? lineItems.map(li => ({
          ...li,
          price_data: {
            ...li.price_data,
            unit_amount: Math.round(li.price_data.unit_amount * depositPercent / 100),
            product_data: {
              ...li.price_data.product_data,
              name: `${li.price_data.product_data.name} (acompte ${depositPercent}%)`,
            },
          },
        }))
      : lineItems;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: finalLineItems,
      customer_email: email,
      metadata: {
        odoo_order_id: String(odooOrderId),
        order_number: orderNumber,
        partner_id: String(partnerId),
        deposit_percent: String(depositPercent || 100),
      },
      success_url: `${FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/checkout/cancel?order_id=${odooOrderId}`,
      payment_intent_data: {
        metadata: {
          odoo_order_id: String(odooOrderId),
          order_number: orderNumber,
        },
      },
    });

    return session;
  }

  // ── Webhook handler ───────────────────────────────────────────────────────
  async function handleStripeWebhook(rawBody, signature) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      throw new Error(`Webhook signature invalid: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const odooOrderId = parseInt(session.metadata?.odoo_order_id);
      const partnerId = parseInt(session.metadata?.partner_id);

      if (!odooOrderId) return { received: true };

      // Confirm the Odoo order
      try {
        await odooCall("sale.order", "action_confirm", [[odooOrderId]]);
      } catch (e) {
        // May already be confirmed
        console.warn("Could not confirm Odoo order:", e.message);
      }

      // Note payment in Odoo order
      const amountPaid = session.amount_total / 100;
      try {
        await odooCall("sale.order", "write", [[odooOrderId], {
          note: `Paiement Stripe reçu: ${amountPaid.toFixed(2)} EUR — session ${session.id}`,
        }]);
      } catch {}

      // Send confirmation email
      try {
        const [order] = await odooCall("sale.order", "read", [[odooOrderId]], {
          fields: ["name", "amount_total", "amount_untaxed", "amount_tax", "date_order", "partner_id", "access_token"],
        }) || [];

        const lines = await odooCall("sale.order.line", "search_read",
          [[["order_id", "=", odooOrderId], ["display_type", "=", false]]],
          { fields: ["name", "product_uom_qty", "price_unit", "price_subtotal"] }
        );

        const partnerData = await odooCall("res.partner", "read", [[partnerId]], {
          fields: ["name", "email"],
        });
        const partner = partnerData?.[0];
        const toEmail = partner?.email || session.customer_email;
        const toName = partner?.name || "Client";

        if (toEmail && order) {
          let pdfBuffer = null;
          if (ODOO_URL && order.access_token) {
            const pdfUrl = `${ODOO_URL}/my/orders/${odooOrderId}?access_token=${order.access_token}&report_type=pdf`;
            pdfBuffer = await fetchOdooPdfBuffer(pdfUrl).catch(() => null);
          }

          // NB: emailOrderConfirmation() builds the HTML body only (it does
          // not send anything itself) — it must be passed as sendEmail's
          // body_html, not called with sendEmail's own {to, subject...} shape.
          await sendEmail({
            to: toEmail,
            subject: `Maison Smalto — Confirmation de commande ${order.name}`,
            body_html: emailOrderConfirmation({
              contactName: toName,
              orderNumber: order.name,
              orderDate: order.date_order,
              lines: (lines || []).map((l) => ({
                name: l.name,
                qty: l.product_uom_qty,
                unit_price: l.price_unit,
                subtotal: l.price_subtotal,
              })),
              amountUntaxed: order.amount_untaxed,
              amountTax: order.amount_tax,
              amountTotal: order.amount_total,
            }),
            attachments: pdfBuffer ? [{ filename: `commande-${order.name}.pdf`, content: pdfBuffer }] : [],
            source: orderEmailSource,
          });
        }
      } catch (e) {
        console.error("Failed to send confirmation email:", e.message);
      }
    }

    return { received: true };
  }

  // ── Get session details (for success page) ─────────────────────────────────
  async function getCheckoutSession(sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items", "payment_intent"],
    });
    return {
      id: session.id,
      status: session.payment_status,
      amountTotal: session.amount_total / 100,
      currency: session.currency,
      customerEmail: session.customer_email,
      orderNumber: session.metadata?.order_number,
      odooOrderId: session.metadata?.odoo_order_id,
    };
  }

  return { createCheckoutSession, handleStripeWebhook, getCheckoutSession };
}
