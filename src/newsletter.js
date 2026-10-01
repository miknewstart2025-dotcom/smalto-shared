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

// ── Double opt-in, désinscription, coupon de bienvenue (site B2C) ────────────
// Odoo est la référence des abonnements et des désinscriptions :
//   - abonnement à la liste « Newsletter » (mailing.subscription) :
//     opt_out=true tant que l'inscription n'est pas confirmée, puis false ;
//     repasse à true à la désinscription (opt_out_datetime renseigné) ;
//   - liste noire Odoo (mail.blacklist) : « se désinscrire de tout » ;
//   - métadonnées B2C sur le contact (mailing.contact, champs x_b2c_*, voir
//     NEWSLETTER_META_FIELDS) : statut, source, langue, version du texte de
//     consentement, dates de demande et de confirmation. Champs créés à part
//     (script b2c-smalto/api/scripts/create-newsletter-fields.mjs) : tant
//     qu'ils n'existent pas, ces métadonnées sont simplement omises.
// Un abonnement en attente (opt_out=true) ne reçoit jamais de campagne.

export const NEWSLETTER_META_FIELDS = {
  status: "x_b2c_status",                 // "pending" | "confirmed" | "unsubscribed"
  source: "x_b2c_source",                 // "popup" | "footer" | "account"
  lang: "x_b2c_lang",                     // "fr" | "en" | "es" | "pt"
  consentVersion: "x_b2c_consent_version", // ex. "popup-v1"
  consentAt: "x_b2c_consent_at",           // datetime UTC de la demande
  confirmedAt: "x_b2c_confirmed_at",       // datetime UTC de la confirmation
};

// Programme fidélité Odoo dédié aux coupons de bienvenue (module loyalty).
// À créer dans Odoo sous ce nom exact pour activer les codes uniques.
export const WELCOME_PROGRAM_NAME = "Bienvenue newsletter B2C";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  const clean = (email || "").trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) throw new Error("Adresse email invalide.");
  return clean;
}

// Format datetime attendu par Odoo (UTC, sans fuseau).
export function toOdooDatetime(date = new Date()) {
  return new Date(date).toISOString().slice(0, 19).replace("T", " ");
}

function fromOdooDatetime(value) {
  return value ? new Date(`${value.replace(" ", "T")}Z`) : null;
}

const metaFieldsCache = new WeakMap();
async function availableMetaFields(call) {
  if (!metaFieldsCache.has(call)) {
    const fields = await call("mailing.contact", "fields_get", [Object.values(NEWSLETTER_META_FIELDS)], { attributes: ["type"] })
      .catch(() => ({}));
    metaFieldsCache.set(call, new Set(Object.keys(fields || {})));
  }
  return metaFieldsCache.get(call);
}

// { status: "pending", ... } → { x_b2c_status: "pending", ... } limité aux
// champs réellement présents dans Odoo.
async function metaValues(call, values) {
  const available = await availableMetaFields(call);
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const field = NEWSLETTER_META_FIELDS[key];
    if (field && available.has(field) && value !== undefined) out[field] = value;
  }
  return out;
}

async function findContact(call, email) {
  const available = await availableMetaFields(call);
  const contacts = await call("mailing.contact", "search_read",
    [[["email", "=ilike", email]]],
    { fields: ["id", ...available], limit: 1, order: "id asc" }
  );
  return contacts?.[0] || null;
}

async function findSubscription(call, contactId, listId) {
  const model = await getSubscriptionModel(call);
  if (!model) return { model: null, sub: null };
  const subs = await call(model, "search_read",
    [[["contact_id", "=", contactId], ["list_id", "=", listId]]],
    { fields: ["id", "opt_out"], limit: 1 }
  );
  return { model, sub: subs?.[0] || null };
}

async function activeBlacklistIds(call, email) {
  return call("mail.blacklist", "search", [[["email", "=ilike", email], ["active", "=", true]]])
    .catch(() => []);
}

function readMeta(contact) {
  if (!contact) return {};
  const meta = {};
  for (const [key, field] of Object.entries(NEWSLETTER_META_FIELDS)) {
    if (field in contact) meta[key] = contact[field] || null;
  }
  return meta;
}

// Demande d'inscription (1re étape du double opt-in). Crée ou met à jour le
// contact, avec un abonnement en attente (opt_out=true) — jamais actif avant
// confirmation. Un abonné déjà actif n'est pas modifié.
// Retour : { state: "pending" | "already_active" }.
export async function requestNewsletterSubscription(
  email,
  { source = null, lang = null, consentVersion = null, consentAt = new Date() } = {},
  { call = odooCall } = {}
) {
  const cleanEmail = normalizeEmail(email);
  const listId = await getOrCreateNewsletterListId(call);
  const meta = await metaValues(call, {
    status: "pending", source, lang, consentVersion,
    consentAt: toOdooDatetime(consentAt), confirmedAt: false,
  });

  let contact = await findContact(call, cleanEmail);
  if (!contact) {
    // Contact créé sans liste puis abonnement créé directement en opt_out :
    // passer par list_ids créerait un abonnement actif, même un instant.
    const contactId = await call("mailing.contact", "create", [{ email: cleanEmail, ...meta }]);
    const model = await getSubscriptionModel(call);
    if (model) {
      await call(model, "create", [{ contact_id: contactId, list_id: listId, opt_out: true }]);
    }
    return { state: "pending" };
  }

  const { model, sub } = await findSubscription(call, contact.id, listId);
  const blacklisted = (await activeBlacklistIds(call, cleanEmail)).length > 0;
  if (sub && !sub.opt_out && !blacklisted) return { state: "already_active" };

  if (!sub && model) {
    await call(model, "create", [{ contact_id: contact.id, list_id: listId, opt_out: true }]);
  } else if (sub && !sub.opt_out) {
    await call(model, "write", [[sub.id], { opt_out: true }]);
  }
  if (Object.keys(meta).length) await call("mailing.contact", "write", [[contact.id], meta]);
  return { state: "pending" };
}

// Confirmation (clic sur le lien de l'email). `requestedAt` = date de la
// demande portée par le lien : un lien plus ancien que la dernière demande
// enregistrée est refusé ("superseded"), ce qui invalide aussi un vieux lien
// après une désinscription puis une nouvelle demande.
// Retour : { state: "confirmed", promo } | { state: "already_confirmed" |
// "not_pending" | "superseded" | "unknown" }.
export async function confirmNewsletterSubscription(
  email,
  { requestedAt = null, confirmedAt = new Date() } = {},
  { call = odooCall } = {}
) {
  const cleanEmail = normalizeEmail(email);
  const listId = await getOrCreateNewsletterListId(call);
  const contact = await findContact(call, cleanEmail);
  if (!contact) return { state: "unknown" };
  const meta = readMeta(contact);

  if ("status" in meta) {
    if (meta.status === "confirmed") return { state: "already_confirmed" };
    if (meta.status !== "pending") return { state: "not_pending" };
  }
  const lastRequest = fromOdooDatetime(meta.consentAt);
  if (requestedAt && lastRequest && new Date(requestedAt).getTime() < lastRequest.getTime() - 2000) {
    return { state: "superseded" };
  }

  const { model, sub } = await findSubscription(call, contact.id, listId);
  if (!sub) {
    if (model) await call(model, "create", [{ contact_id: contact.id, list_id: listId, opt_out: false }]);
  } else if (sub.opt_out) {
    await call(model, "write", [[sub.id], { opt_out: false }]);
  }
  const blacklisted = await activeBlacklistIds(call, cleanEmail);
  if (blacklisted.length) await call("mail.blacklist", "write", [blacklisted, { active: false }]);

  const values = await metaValues(call, { status: "confirmed", confirmedAt: toOdooDatetime(confirmedAt) });
  if (Object.keys(values).length) await call("mailing.contact", "write", [[contact.id], values]);

  const config = await getNewsletterConfig({ call });
  return { state: "confirmed", promo: config.enabled ? { percent: config.percent, code: config.code } : null };
}

// Désinscription. scope "newsletter" : opt_out sur l'abonnement à la liste
// « Newsletter » ; scope "all" : en plus, adresse en liste noire Odoo (plus
// aucun email marketing, toutes listes confondues). Idempotent.
export async function unsubscribeFromNewsletter(
  email,
  { scope = "newsletter", reasonId = null, at = new Date() } = {},
  { call = odooCall } = {}
) {
  if (!["newsletter", "all"].includes(scope)) throw new Error("Portée de désinscription invalide.");
  const cleanEmail = normalizeEmail(email);
  const listId = await getOrCreateNewsletterListId(call);
  const contact = await findContact(call, cleanEmail);

  if (contact) {
    const { model, sub } = await findSubscription(call, contact.id, listId);
    if (sub && !sub.opt_out) {
      await call(model, "write", [[sub.id], {
        opt_out: true,
        opt_out_datetime: toOdooDatetime(at),
        ...(reasonId ? { opt_out_reason_id: reasonId } : {}),
      }]);
    }
    const values = await metaValues(call, { status: "unsubscribed" });
    if (Object.keys(values).length) await call("mailing.contact", "write", [[contact.id], values]);
  }

  if (scope === "all") {
    const existing = await call("mail.blacklist", "search_read",
      [[["email", "=ilike", cleanEmail], ["active", "in", [true, false]]]],
      { fields: ["id", "active"], limit: 1 }
    );
    if (!existing?.length) {
      await call("mail.blacklist", "create", [{ email: cleanEmail }]);
    } else if (!existing[0].active) {
      await call("mail.blacklist", "write", [[existing[0].id], { active: true }]);
    }
  }
  return { state: "unsubscribed", scope };
}

// État Odoo d'un inscrit (export de la preuve de consentement, support).
export async function getNewsletterContactInfo(email, { call = odooCall } = {}) {
  const cleanEmail = normalizeEmail(email);
  const listId = await getOrCreateNewsletterListId(call);
  const contact = await findContact(call, cleanEmail);
  if (!contact) return null;
  const { sub } = await findSubscription(call, contact.id, listId);
  const blacklisted = (await activeBlacklistIds(call, cleanEmail)).length > 0;
  return {
    contactId: contact.id,
    listed: !!sub,
    optOut: sub ? !!sub.opt_out : null,
    blacklisted,
    meta: readMeta(contact),
  };
}

// ── Coupon unique de bienvenue (module Odoo loyalty) ─────────────────────────
// Actif seulement si le module est installé ET qu'un programme nommé
// WELCOME_PROGRAM_NAME existe. Sinon null : le site retombe sur le code
// partagé du réglage smalto.b2c.newsletter_promo, qui fixe aussi le % dans
// les deux cas.
async function getWelcomeProgramId(call) {
  const hasModel = await call("ir.model", "search", [[["model", "=", "loyalty.program"]]], { limit: 1 }).catch(() => []);
  if (!hasModel?.length) return null;
  const programs = await call("loyalty.program", "search", [[["name", "=", WELCOME_PROGRAM_NAME], ["active", "=", true]]], { limit: 1 })
    .catch(() => []);
  return programs?.[0] || null;
}

export async function issueWelcomeCoupon({ call = odooCall } = {}) {
  const programId = await getWelcomeProgramId(call);
  if (!programId) return null;
  const cardId = await call("loyalty.card", "create", [{ program_id: programId, points: 1 }]);
  const [card] = await call("loyalty.card", "read", [[cardId]], { fields: ["code"] });
  return card?.code || null;
}

export async function findWelcomeCoupon(code, { call = odooCall } = {}) {
  const clean = (code || "").trim();
  if (!clean) return null;
  const programId = await getWelcomeProgramId(call);
  if (!programId) return null;
  const cards = await call("loyalty.card", "search_read",
    [[["program_id", "=", programId], ["code", "=ilike", clean]]],
    { fields: ["id", "code", "points"], limit: 1 }
  );
  return cards?.[0] || null;
}
