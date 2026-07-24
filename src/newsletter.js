import { odooCall } from "./odoo-core.js";

// Réglage newsletter B2C (activation + % de réduction + code promo partagé),
// géré depuis l'admin B2B, consommé par le site B2C. Stocké dans Odoo comme
// les saisons, pour rester la source de vérité partagée entre les deux apps.
const CONFIG_KEY = "smalto.b2c.newsletter_promo";
const NEWSLETTER_LIST_NAME = "Newsletter";

const DEFAULT_CONFIG = { enabled: false, percent: 10, code: "BIENVENUE10" };

export async function getNewsletterConfig() {
  try {
    const raw = await odooCall("ir.config_parameter", "get_param", [CONFIG_KEY]);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setNewsletterConfig(data) {
  const percent = Number(data.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 90) {
    throw new Error("Le pourcentage doit être compris entre 1 et 90.");
  }
  const code = (data.code || "").trim().toUpperCase();
  if (!code) throw new Error("Le code promo est requis.");

  const config = { enabled: !!data.enabled, percent, code };
  await odooCall("ir.config_parameter", "set_param", [CONFIG_KEY, JSON.stringify(config)]);
  return config;
}

async function getOrCreateNewsletterListId() {
  const lists = await odooCall("mailing.list", "search_read",
    [[["name", "=", NEWSLETTER_LIST_NAME]]],
    { fields: ["id"], limit: 1 }
  );
  if (lists?.length) return lists[0].id;
  return odooCall("mailing.list", "create", [{ name: NEWSLETTER_LIST_NAME }]);
}

// Inscrit un email à la liste "Newsletter" Odoo (mailing.contact), idempotent.
// Retourne la config promo active si l'inscription (ou une inscription déjà
// existante) donne droit au code de bienvenue.
export async function subscribeToNewsletter(email) {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Adresse email invalide.");
  }

  const listId = await getOrCreateNewsletterListId();

  const existing = await odooCall("mailing.contact", "search_read",
    [[["email", "=", cleanEmail], ["list_ids", "in", [listId]]]],
    { fields: ["id"], limit: 1 }
  );

  if (!existing?.length) {
    const contacts = await odooCall("mailing.contact", "search_read",
      [[["email", "=", cleanEmail]]],
      { fields: ["id"], limit: 1 }
    );
    if (contacts?.length) {
      await odooCall("mailing.contact", "write", [[contacts[0].id], { list_ids: [[4, listId]] }]);
    } else {
      await odooCall("mailing.contact", "create", [{ email: cleanEmail, list_ids: [[4, listId]] }]);
    }
  }

  const config = await getNewsletterConfig();
  return config.enabled ? { percent: config.percent, code: config.code } : null;
}
