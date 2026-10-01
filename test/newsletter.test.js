import { test } from "node:test";
import assert from "node:assert/strict";

// odoo-core.js lit ODOO_URL au chargement : une valeur factice suffit, tous
// les appels Odoo passent par le faux `call` injecté ci-dessous.
process.env.ODOO_URL ||= "http://127.0.0.1:1";
const { subscribeToNewsletter } = await import("../src/newsletter.js");

// Faux Odoo en mémoire : liste « Newsletter », contacts, abonnements
// (modèle mailing.subscription, Odoo ≥ 17), liste noire, config promo.
function fakeOdoo({ contacts = [], subscriptions = [], blacklist = [], promo = null } = {}) {
  const db = { lists: [{ id: 1, name: "Newsletter" }], contacts, subscriptions, blacklist };
  const writes = [];
  let nextId = 100;
  const call = async (model, method, args) => {
    if (model === "ir.config_parameter") return promo ? JSON.stringify(promo) : false;
    if (model === "ir.model") return args[0][0][2] === "mailing.subscription" ? [1] : [];
    if (model === "mailing.list" && method === "search_read") return db.lists;
    if (model === "mailing.contact" && method === "search_read") {
      const email = args[0][0][2];
      return db.contacts.filter((c) => c.email.toLowerCase() === email.toLowerCase());
    }
    if (model === "mailing.contact" && method === "create") {
      const id = nextId++;
      db.contacts.push({ id, email: args[0].email });
      db.subscriptions.push({ id: nextId++, contact_id: id, list_id: 1, opt_out: false });
      writes.push(["create", model]);
      return id;
    }
    if (model === "mailing.contact" && method === "write") {
      const [[id]] = args;
      db.subscriptions.push({ id: nextId++, contact_id: id, list_id: 1, opt_out: false });
      writes.push(["write", model]);
      return true;
    }
    if (model === "mailing.subscription" && method === "search_read") {
      const contactId = args[0][0][2];
      return db.subscriptions.filter((s) => s.contact_id === contactId && s.list_id === 1);
    }
    if (model === "mailing.subscription" && method === "write") {
      const [[id], vals] = args;
      Object.assign(db.subscriptions.find((s) => s.id === id), vals);
      writes.push(["write", model]);
      return true;
    }
    if (model === "mail.blacklist" && method === "search") {
      const email = args[0][0][2];
      return db.blacklist.filter((b) => b.active && b.email.toLowerCase() === email.toLowerCase()).map((b) => b.id);
    }
    if (model === "mail.blacklist" && method === "write") {
      const [ids, vals] = args;
      db.blacklist.filter((b) => ids.includes(b.id)).forEach((b) => Object.assign(b, vals));
      writes.push(["write", model]);
      return true;
    }
    throw new Error(`appel inattendu ${model}.${method}`);
  };
  return { call, db, writes };
}

const subOf = (db, email) => {
  const c = db.contacts.find((x) => x.email.toLowerCase() === email);
  return db.subscriptions.find((s) => s.contact_id === c?.id && s.list_id === 1);
};

test("nouvel email : contact créé et abonné", async () => {
  const o = fakeOdoo();
  await subscribeToNewsletter(" New@Ex.com ", { call: o.call });
  assert.equal(subOf(o.db, "new@ex.com").opt_out, false);
});

test("réinscription après désinscription : abonnement réactivé", async () => {
  const o = fakeOdoo({
    contacts: [{ id: 1, email: "back@ex.com" }],
    subscriptions: [{ id: 10, contact_id: 1, list_id: 1, opt_out: true }],
  });
  await subscribeToNewsletter("back@ex.com", { call: o.call });
  assert.equal(subOf(o.db, "back@ex.com").opt_out, false);
});

test("email en liste noire Odoo : levée de la liste noire", async () => {
  const o = fakeOdoo({
    contacts: [{ id: 1, email: "bl@ex.com" }],
    subscriptions: [{ id: 10, contact_id: 1, list_id: 1, opt_out: false }],
    blacklist: [{ id: 5, email: "bl@ex.com", active: true }],
  });
  await subscribeToNewsletter("bl@ex.com", { call: o.call });
  assert.equal(o.db.blacklist[0].active, false);
});

test("contact existant hors liste (casse différente) : ajouté, sans doublon", async () => {
  const o = fakeOdoo({ contacts: [{ id: 1, email: "Mixed@Ex.com" }] });
  await subscribeToNewsletter("mixed@ex.com", { call: o.call });
  assert.equal(o.db.contacts.length, 1);
  assert.equal(subOf(o.db, "mixed@ex.com").opt_out, false);
});

test("déjà abonné et actif : aucune écriture (idempotent)", async () => {
  const o = fakeOdoo({
    contacts: [{ id: 1, email: "ok@ex.com" }],
    subscriptions: [{ id: 10, contact_id: 1, list_id: 1, opt_out: false }],
  });
  await subscribeToNewsletter("ok@ex.com", { call: o.call });
  assert.deepEqual(o.writes, []);
});

test("code promo renvoyé seulement si la popup est activée", async () => {
  const on = fakeOdoo({ promo: { enabled: true, percent: 15, code: "HELLO15" } });
  assert.deepEqual(await subscribeToNewsletter("a@ex.com", { call: on.call }), { percent: 15, code: "HELLO15" });
  const off = fakeOdoo({ promo: { enabled: false, percent: 15, code: "HELLO15" } });
  assert.equal(await subscribeToNewsletter("a@ex.com", { call: off.call }), null);
});

test("email invalide refusé", async () => {
  await assert.rejects(subscribeToNewsletter("pas-un-email", { call: fakeOdoo().call }), /invalide/);
});
