import { odooCall } from "./odoo-core.js";

// Réglage newsletter B2C (activation + % de réduction + code promo partagé),
// géré depuis l'admin B2B, consommé par le site B2C. Stocké dans Odoo comme
// les saisons, pour rester la source de vérité partagée entre les deux apps.
const CONFIG_KEY = "smalto.b2c.newsletter_promo";
const NEWSLETTER_LIST_NAME = "Newsletter";

const DEFAULT_CONFIG = { enabled: false, percent: 10, code: "BIENVENUE10" };

export async function getNewsletterConfig({ call = odooCall } = {}) {
  try {
    const raw = await call("ir.config_parameter", "get_param", [CONFIG_KEY]);
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

async function getOrCreateNewsletterListId(call) {
  const lists = await call("mailing.list", "search_read",
    [[["name", "=", NEWSLETTER_LIST_NAME]]],
    { fields: ["id"], limit: 1 }
  );
  if (lists?.length) return lists[0].id;
  return call("mailing.list", "create", [{ name: NEWSLETTER_LIST_NAME }]);
}

// Modèle d'abonnement selon la version d'Odoo : mailing.subscription (≥ 17)
// ou mailing.contact.subscription (≤ 16) — tous deux portent opt_out.
async function getSubscriptionModel(call) {
  for (const model of ["mailing.subscription", "mailing.contact.subscription"]) {
    const found = await call("ir.model", "search", [[["model", "=", model]]], { limit: 1 });
    if (found?.length) return model;
  }
  return null;
}

// Inscrit un email à la liste "Newsletter" Odoo (mailing.contact), idempotent.
// Une inscription est une nouvelle demande explicite : si la personne s'était
// désinscrite (abonnement opt_out, ou adresse en liste noire Odoo via « se
// désinscrire de tout »), elle est réactivée — sinon elle resterait
// silencieusement désinscrite alors que la popup lui confirme l'inscription.
// Retourne la config promo active si l'inscription (ou une inscription déjà
// existante) donne droit au code de bienvenue.
export async function subscribeToNewsletter(email, { call = odooCall } = {}) {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Adresse email invalide.");
  }

  const listId = await getOrCreateNewsletterListId(call);

  // =ilike : Odoo peut stocker l'email avec une autre casse.
  const contacts = await call("mailing.contact", "search_read",
    [[["email", "=ilike", cleanEmail]]],
    { fields: ["id"], limit: 1 }
  );

  if (!contacts?.length) {
    await call("mailing.contact", "create", [{ email: cleanEmail, list_ids: [[4, listId]] }]);
  } else {
    const contactId = contacts[0].id;
    const subModel = await getSubscriptionModel(call);
    const subs = subModel
      ? await call(subModel, "search_read",
          [[["contact_id", "=", contactId], ["list_id", "=", listId]]],
          { fields: ["id", "opt_out"], limit: 1 })
      : [];
    if (!subs?.length) {
      await call("mailing.contact", "write", [[contactId], { list_ids: [[4, listId]] }]);
    } else if (subs[0].opt_out) {
      await call(subModel, "write", [[subs[0].id], { opt_out: false }]);
    }
  }

  // Liste noire Odoo (désinscription de toutes les listes) : levée, comme le
  // fait le formulaire d'inscription natif d'Odoo.
  const blacklisted = await call("mail.blacklist", "search",
    [[["email", "=ilike", cleanEmail], ["active", "=", true]]], { limit: 1 }
  ).catch(() => []); // module mail.blacklist absent : rien à lever
  if (blacklisted?.length) {
    await call("mail.blacklist", "write", [blacklisted, { active: false }]);
  }

  const config = await getNewsletterConfig({ call });
  return config.enabled ? { percent: config.percent, code: config.code } : null;
}
