import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ODOO_URL ||= "http://127.0.0.1:1";
const {
  B2C_SETTINGS, B2C_SETTING_NAMES, getB2CSetting, getB2CSettings, setB2CSetting,
  getB2CSettingDefault, parseB2CSetting, phoneHref,
} = await import("../src/b2c-settings.js");
const { buildFrom } = await import("../src/email-core.js");

// Faux ir.config_parameter en mémoire.
function fakeOdoo(params = {}) {
  const store = new Map(Object.entries(params));
  const writes = [];
  const call = async (model, method, args) => {
    assert.equal(model, "ir.config_parameter");
    if (method === "get_param") return store.get(args[0]) ?? false;
    if (method === "set_param") { store.set(args[0], args[1]); writes.push(args); return true; }
    if (method === "search_read") {
      const keys = args[0][0][2];
      return keys.filter((k) => store.has(k)).map((k) => ({ key: k, value: store.get(k) }));
    }
    throw new Error(`appel inattendu ${method}`);
  };
  return { call, store, writes };
}
const down = async () => { throw new Error("Odoo injoignable"); };

test("chaque valeur par défaut passe sa propre validation, à l'identique", () => {
  for (const name of B2C_SETTING_NAMES) {
    assert.deepEqual(B2C_SETTINGS[name].validate(getB2CSettingDefault(name)), getB2CSettingDefault(name), name);
  }
});

test("clés : préfixe smalto.b2c.* sauf la liste revendeurs commune", () => {
  for (const name of B2C_SETTING_NAMES) {
    const key = B2C_SETTINGS[name].key;
    if (name === "retailPartners") assert.equal(key, "smalto.retail_partners");
    else assert.match(key, /^smalto\.b2c\.[a-z_]+$/);
  }
  // Les clés existantes du contrat B2B ne sont pas réutilisées.
  const keys = B2C_SETTING_NAMES.map((n) => B2C_SETTINGS[n].key);
  for (const k of ["smalto.b2c.newsletter_promo", "smalto.b2c.free_shipping_threshold", "smalto.google_maps_api_key"]) {
    assert.ok(!keys.includes(k), k);
  }
});

test("clé absente d'Odoo ou Odoo en panne : valeur par défaut", async () => {
  assert.deepEqual(await getB2CSetting("home", { call: fakeOdoo().call }), getB2CSettingDefault("home"));
  assert.deepEqual(await getB2CSetting("home", { call: down }), getB2CSettingDefault("home"));
  const all = await getB2CSettings({ call: down });
  assert.deepEqual(Object.keys(all), B2C_SETTING_NAMES);
});

test("lecture : fusion avec les défauts, y compris les textes par langue", async () => {
  const { call } = fakeOdoo({ "smalto.b2c.home": JSON.stringify({ slideDurationMs: 5000, shippingBanner: { en: "Free shipping" } }) });
  const home = await getB2CSetting("home", { call });
  assert.equal(home.slideDurationMs, 5000);
  assert.deepEqual(home.heroImages, ["hero-1", "hero-2", "hero-3", "hero-4"]);
  assert.deepEqual(home.shippingBanner, { fr: null, en: "Free shipping", es: null, pt: null });
});

test("lecture : JSON illisible ou devenu invalide → défaut complet", () => {
  assert.deepEqual(parseB2CSetting("shippingRates", "{pas du json"), getB2CSettingDefault("shippingRates"));
  assert.deepEqual(parseB2CSetting("shippingRates", JSON.stringify({ europe: -3 })), getB2CSettingDefault("shippingRates"));
});

test("getB2CSettings publicOnly n'expose jamais les emails", async () => {
  const { call } = fakeOdoo({ "smalto.b2c.emails": JSON.stringify({ replyTo: "x@smalto.fr" }) });
  const pub = await getB2CSettings({ call, publicOnly: true });
  assert.ok(!("emails" in pub));
  const all = await getB2CSettings({ call });
  assert.equal(all.emails.replyTo, "x@smalto.fr");
});

test("écriture : valide, normalise et enregistre en JSON", async () => {
  const odoo = fakeOdoo();
  const saved = await setB2CSetting("shippingRates", { europe: "21.5", world: 30, express: 15, premium: 25.999 }, { call: odoo.call });
  assert.deepEqual(saved, { europe: 21.5, world: 30, express: 15, premium: 26 });
  assert.deepEqual(odoo.writes, [["smalto.b2c.shipping_rates", JSON.stringify(saved)]]);
});

test("écriture refusée : rien n'est écrit, message affichable", async () => {
  const odoo = fakeOdoo();
  const cases = [
    ["newsletterPopup", { delaySeconds: 15, dismissDays: 30, subscribedDays: 365, pages: [] }, /Pages de la popup/],
    ["newsletterPopup", { delaySeconds: 1.5, dismissDays: 30, subscribedDays: 365, pages: ["produit"] }, /Délai/],
    ["home", { heroImages: ["hero-9"], slideDurationMs: 3000 }, /Visuels/],
    ["home", { heroImages: ["hero-1", "hero-1"], slideDurationMs: 3000 }, /Visuels/],
    ["home", { heroImages: ["hero-1"], slideDurationMs: 3000, shippingBanner: { fr: "<b>x</b>" } }, /< et >/],
    ["emails", { signature: "S", replyTo: "pas-un-email" }, /Adresse de réponse/],
    ["emails", { signature: "S", fromName: 'A"B' }, /guillemets/],
    ["boutique", { ...getB2CSettingDefault("boutique"), phone: "appelez-nous" }, /Téléphone/],
    ["retailPartners", [{ name: "X", city: "Paris", country: "France", lat: 48 }], /latitude et longitude/],
    ["retailPartners", "pas une liste", /Revendeurs/],
  ];
  for (const [name, data, msg] of cases) {
    await assert.rejects(setB2CSetting(name, data, { call: odoo.call }), msg, name);
  }
  await assert.rejects(setB2CSetting("inconnu", {}, { call: odoo.call }), /inconnu/);
  assert.equal(odoo.writes.length, 0);
});

test("popup : pages normalisées dans l'ordre de référence, sans doublon", () => {
  const v = B2C_SETTINGS.newsletterPopup.validate({ delaySeconds: 0, dismissDays: 1, subscribedDays: 1, pages: ["produit", "catalogue", "produit"] });
  assert.deepEqual(v.pages, ["catalogue", "produit"]);
});

test("revendeurs : champs vides retirés, inconnus ignorés, GPS conservé", () => {
  const [p] = B2C_SETTINGS.retailPartners.validate([{ name: " A ", address: "", city: "Lyon", country: "France", lat: "45.76", lng: 4.83, extra: "x" }]);
  assert.deepEqual(p, { name: "A", city: "Lyon", country: "France", lat: 45.76, lng: 4.83 });
});

test("phoneHref reproduit le lien actuel", () => {
  assert.equal(phoneHref("+33 (0)1 84 74 34 31"), "tel:+33184743431");
  assert.equal(phoneHref("01 84 74 34 31"), "tel:0184743431");
});

test("buildFrom : seul le nom change, l'adresse vérifiée reste", () => {
  assert.equal(buildFrom(null, "Maison Smalto <noreply@smalto.com>"), "Maison Smalto <noreply@smalto.com>");
  assert.equal(buildFrom("Smalto Paris", "Maison Smalto <noreply@smalto.com>"), "Smalto Paris <noreply@smalto.com>");
  assert.equal(buildFrom("X", "noreply@smalto.com"), "X <noreply@smalto.com>");
  assert.equal(buildFrom('A"<b>', "M <n@s.com>"), "Ab <n@s.com>");
});
