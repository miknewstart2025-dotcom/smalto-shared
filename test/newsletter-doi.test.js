import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ODOO_URL ||= "http://127.0.0.1:1";
const {
  requestNewsletterSubscription, confirmNewsletterSubscription, unsubscribeFromNewsletter,
  getNewsletterContactInfo, issueWelcomeCoupon, findWelcomeCoupon, subscribeToNewsletter,
  NEWSLETTER_META_FIELDS, WELCOME_PROGRAM_NAME, toOdooDatetime,
} = await import("../src/newsletter.js");
const { buildEmailPayload } = await import("../src/email-core.js");

const META = Object.values(NEWSLETTER_META_FIELDS);

// Faux Odoo en mémoire. `metaFields` : champs x_b2c_* présents ou non ;
// `loyalty` : module fidélité installé avec le programme de bienvenue.
function fakeOdoo({ contacts = [], subscriptions = [], blacklist = [], promo = null, metaFields = true, loyalty = false } = {}) {
  const db = { contacts, subscriptions, blacklist, cards: [] };
  const writes = [];
  let nextId = 100;
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const domainValue = (domain, field) => domain.find((d) => d[0] === field)?.[2];
  const call = async (model, method, args, kwargs = {}) => {
    if (["create", "write"].includes(method)) writes.push([model, method, args]);
    if (model === "ir.config_parameter") return promo ? JSON.stringify(promo) : false;
    if (model === "ir.model") {
      const m = args[0][0][2];
      if (m === "mailing.subscription") return [1];
      if (m === "loyalty.program") return loyalty ? [2] : [];
      return [];
    }
    if (model === "mailing.list") return method === "search_read" ? [{ id: 1, name: "Newsletter" }] : 1;
    if (model === "mailing.contact") {
      if (method === "fields_get") return metaFields ? Object.fromEntries(META.map((f) => [f, { type: "char" }])) : {};
      if (method === "search_read") return db.contacts.filter((c) => eq(c.email, domainValue(args[0], "email")));
      if (method === "create") { const id = nextId++; db.contacts.push({ id, ...args[0] }); return id; }
      if (method === "write") { for (const c of db.contacts) if (args[0].includes(c.id)) Object.assign(c, args[1]); return true; }
    }
    if (model === "mailing.subscription") {
      if (method === "search_read") return db.subscriptions.filter((s) => s.contact_id === domainValue(args[0], "contact_id") && s.list_id === domainValue(args[0], "list_id"));
      if (method === "create") { const id = nextId++; db.subscriptions.push({ id, ...args[0] }); return id; }
      if (method === "write") { for (const s of db.subscriptions) if (args[0].includes(s.id)) Object.assign(s, args[1]); return true; }
    }
    if (model === "mail.blacklist") {
      const domain = Array.isArray(args[0]) ? args[0] : [];
      const email = domainValue(domain, "email");
      const activeFilter = domain.find((d) => d[0] === "active");
      const match = (b) => eq(b.email, email) && (activeFilter?.[1] === "in" ? true : b.active === activeFilter?.[2]);
      if (method === "search") return db.blacklist.filter(match).map((b) => b.id);
      if (method === "search_read") return db.blacklist.filter(match);
      if (method === "create") { const id = nextId++; db.blacklist.push({ id, email: args[0].email, active: true }); return id; }
      if (method === "write") { for (const b of db.blacklist) if (args[0].includes(b.id)) Object.assign(b, args[1]); return true; }
    }
    if (model === "loyalty.program" && method === "search") return loyalty && domainValue(args[0], "name") === WELCOME_PROGRAM_NAME ? [7] : [];
    if (model === "loyalty.card") {
      if (method === "create") { const id = nextId++; db.cards.push({ id, code: `WELC-${id}`, points: 1, program_id: args[0].program_id }); return id; }
      if (method === "read") return db.cards.filter((c) => args[0].includes(c.id));
      if (method === "search_read") return db.cards.filter((c) => eq(c.code, domainValue(args[0], "code")));
    }
    throw new Error(`appel inattendu ${model}.${method}`);
  };
  return { call, db, writes };
}

const sub = (db, contactId) => db.subscriptions.find((s) => s.contact_id === contactId);

test("nouvelle demande : contact + abonnement EN ATTENTE (jamais actif), métadonnées écrites", async () => {
  const o = fakeOdoo();
  const at = new Date("2026-10-01T10:00:00Z");
  const res = await requestNewsletterSubscription(" Jean@Ex.FR ", { source: "popup", lang: "fr", consentVersion: "popup-v1", consentAt: at }, { call: o.call });
  assert.deepEqual(res, { state: "pending" });
  const [c] = o.db.contacts;
  assert.equal(c.email, "jean@ex.fr");
  assert.equal(c.x_b2c_status, "pending");
  assert.equal(c.x_b2c_source, "popup");
  assert.equal(c.x_b2c_consent_at, "2026-10-01 10:00:00");
  assert.equal(sub(o.db, c.id).opt_out, true);
  // L'abonnement n'est jamais créé via list_ids (qui le rendrait actif).
  assert.ok(!o.writes.some(([m, meth, a]) => m === "mailing.contact" && meth === "create" && a[0].list_ids));
});

test("abonné déjà actif : aucune écriture", async () => {
  const o = fakeOdoo({ contacts: [{ id: 1, email: "a@b.fr" }], subscriptions: [{ id: 2, contact_id: 1, list_id: 1, opt_out: false }] });
  assert.deepEqual(await requestNewsletterSubscription("a@b.fr", { source: "footer" }, { call: o.call }), { state: "already_active" });
  assert.equal(o.writes.length, 0);
});

test("désinscrit qui redemande : repasse en attente, reste opt_out jusqu'à confirmation", async () => {
  const o = fakeOdoo({
    contacts: [{ id: 1, email: "A@b.fr", x_b2c_status: "unsubscribed" }],
    subscriptions: [{ id: 2, contact_id: 1, list_id: 1, opt_out: true }],
    blacklist: [{ id: 3, email: "a@b.fr", active: true }],
  });
  assert.deepEqual(await requestNewsletterSubscription("a@b.fr", { source: "popup" }, { call: o.call }), { state: "pending" });
  assert.equal(o.db.contacts[0].x_b2c_status, "pending");
  assert.equal(o.db.subscriptions[0].opt_out, true);
  assert.equal(o.db.blacklist[0].active, true, "liste noire levée seulement à la confirmation");
});

test("confirmation : abonnement actif, liste noire levée, date enregistrée, promo renvoyée", async () => {
  const o = fakeOdoo({ promo: { enabled: true, percent: 10, code: "BIENVENUE10" } });
  const requestedAt = new Date("2026-10-01T10:00:00Z");
  await requestNewsletterSubscription("a@b.fr", { consentAt: requestedAt }, { call: o.call });
  o.db.blacklist.push({ id: 50, email: "a@b.fr", active: true });
  const res = await confirmNewsletterSubscription("a@b.fr", { requestedAt, confirmedAt: new Date("2026-10-02T08:30:00Z") }, { call: o.call });
  assert.deepEqual(res, { state: "confirmed", promo: { percent: 10, code: "BIENVENUE10" } });
  const [c] = o.db.contacts;
  assert.equal(c.x_b2c_status, "confirmed");
  assert.equal(c.x_b2c_confirmed_at, "2026-10-02 08:30:00");
  assert.equal(sub(o.db, c.id).opt_out, false);
  assert.equal(o.db.blacklist[0].active, false);
  // Deuxième clic : sans effet.
  assert.deepEqual(await confirmNewsletterSubscription("a@b.fr", { requestedAt }, { call: o.call }), { state: "already_confirmed" });
});

test("confirmation refusée : lien périmé par une demande plus récente, ou après désinscription", async () => {
  const o = fakeOdoo();
  const first = new Date("2026-10-01T10:00:00Z");
  await requestNewsletterSubscription("a@b.fr", { consentAt: first }, { call: o.call });
  await requestNewsletterSubscription("a@b.fr", { consentAt: new Date("2026-10-03T10:00:00Z") }, { call: o.call });
  assert.equal((await confirmNewsletterSubscription("a@b.fr", { requestedAt: first }, { call: o.call })).state, "superseded");
  await unsubscribeFromNewsletter("a@b.fr", {}, { call: o.call });
  assert.equal((await confirmNewsletterSubscription("a@b.fr", { requestedAt: new Date("2026-10-03T10:00:00Z") }, { call: o.call })).state, "not_pending");
  assert.equal((await confirmNewsletterSubscription("inconnu@b.fr", {}, { call: o.call })).state, "unknown");
  assert.equal(sub(o.db, o.db.contacts[0].id).opt_out, true);
});

test("désinscription newsletter : opt_out + date, sans liste noire ; idempotente", async () => {
  const o = fakeOdoo({ contacts: [{ id: 1, email: "a@b.fr", x_b2c_status: "confirmed" }], subscriptions: [{ id: 2, contact_id: 1, list_id: 1, opt_out: false }] });
  const at = new Date("2026-10-05T12:00:00Z");
  assert.deepEqual(await unsubscribeFromNewsletter("a@b.fr", { at }, { call: o.call }), { state: "unsubscribed", scope: "newsletter" });
  assert.equal(o.db.subscriptions[0].opt_out, true);
  assert.equal(o.db.subscriptions[0].opt_out_datetime, "2026-10-05 12:00:00");
  assert.equal(o.db.contacts[0].x_b2c_status, "unsubscribed");
  assert.equal(o.db.blacklist.length, 0);
  const before = o.writes.length;
  await unsubscribeFromNewsletter("a@b.fr", { at }, { call: o.call });
  assert.equal(o.writes.filter(([m]) => m === "mailing.subscription").length, o.writes.slice(0, before).filter(([m]) => m === "mailing.subscription").length);
});

test("désinscription de tout : liste noire créée, ou réactivée si archivée ; email inconnu accepté", async () => {
  const o = fakeOdoo({ blacklist: [{ id: 9, email: "old@b.fr", active: false }] });
  await unsubscribeFromNewsletter("new@b.fr", { scope: "all" }, { call: o.call });
  await unsubscribeFromNewsletter("OLD@b.fr", { scope: "all" }, { call: o.call });
  assert.deepEqual(o.db.blacklist.map((b) => [b.email, b.active]), [["old@b.fr", true], ["new@b.fr", true]]);
  await assert.rejects(unsubscribeFromNewsletter("a@b.fr", { scope: "tout" }, { call: o.call }), /Portée/);
});

test("champs x_b2c_* absents d'Odoo : le parcours fonctionne, métadonnées omises", async () => {
  const o = fakeOdoo({ metaFields: false });
  assert.deepEqual(await requestNewsletterSubscription("a@b.fr", { source: "popup" }, { call: o.call }), { state: "pending" });
  assert.ok(!Object.keys(o.db.contacts[0]).some((k) => k.startsWith("x_b2c")));
  assert.equal((await confirmNewsletterSubscription("a@b.fr", {}, { call: o.call })).state, "confirmed");
  assert.equal(o.db.subscriptions[0].opt_out, false);
});

test("export : état Odoo d'un inscrit", async () => {
  const o = fakeOdoo({
    contacts: [{ id: 1, email: "a@b.fr", x_b2c_status: "confirmed", x_b2c_source: "footer", x_b2c_lang: "en", x_b2c_consent_version: "footer-v1", x_b2c_consent_at: "2026-10-01 10:00:00", x_b2c_confirmed_at: "2026-10-01 10:05:00" }],
    subscriptions: [{ id: 2, contact_id: 1, list_id: 1, opt_out: false }],
  });
  const info = await getNewsletterContactInfo("A@B.fr", { call: o.call });
  assert.deepEqual(info, {
    contactId: 1, listed: true, optOut: false, blacklisted: false,
    meta: { status: "confirmed", source: "footer", lang: "en", consentVersion: "footer-v1", consentAt: "2026-10-01 10:00:00", confirmedAt: "2026-10-01 10:05:00" },
  });
  assert.equal(await getNewsletterContactInfo("x@b.fr", { call: o.call }), null);
});

test("coupon : null sans module fidélité ; code unique avec le programme dédié", async () => {
  assert.equal(await issueWelcomeCoupon({ call: fakeOdoo().call }), null);
  assert.equal(await findWelcomeCoupon("WELC-1", { call: fakeOdoo().call }), null);
  const o = fakeOdoo({ loyalty: true });
  const a = await issueWelcomeCoupon({ call: o.call });
  const b = await issueWelcomeCoupon({ call: o.call });
  assert.ok(a && b && a !== b);
  assert.deepEqual(await findWelcomeCoupon(a.toLowerCase(), { call: o.call }), { id: o.db.cards[0].id, code: a, points: 1, program_id: 7 });
});

test("subscribeToNewsletter (utilisée par le B2B) reste inchangée : abonnement actif immédiat", async () => {
  const o = fakeOdoo({ metaFields: false });
  const call = async (model, method, args, kw) => {
    if (model === "mailing.contact" && method === "create" && args[0].list_ids) {
      const id = await o.call("mailing.contact", "create", [{ email: args[0].email }]);
      o.db.subscriptions.push({ id: 999, contact_id: id, list_id: 1, opt_out: false });
      return id;
    }
    return o.call(model, method, args, kw);
  };
  await subscribeToNewsletter("a@b.fr", { call });
  assert.equal(o.db.subscriptions[0].opt_out, false);
});

test("toOdooDatetime : UTC sans fuseau", () => {
  assert.equal(toOdooDatetime(new Date("2026-10-01T10:00:05.123Z")), "2026-10-01 10:00:05");
});

test("email : sans copies internes ni digital@ quand internalCopies=false ; en-têtes transmis", () => {
  const normal = buildEmailPayload({ to: "a@b.fr", subject: "S", body_html: "x", cc: ["contact@smalto.fr"] });
  assert.deepEqual(normal.cc, ["digital@smalto.fr", "contact@smalto.fr"]);
  assert.equal(normal.headers, undefined);
  const personal = buildEmailPayload({
    to: "a@b.fr", subject: "S", body_html: "x", cc: ["contact@smalto.fr"], internalCopies: false,
    headers: { "List-Unsubscribe": "<https://x/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  assert.equal(personal.cc, undefined);
  assert.deepEqual(personal.headers, { "List-Unsubscribe": "<https://x/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
});
