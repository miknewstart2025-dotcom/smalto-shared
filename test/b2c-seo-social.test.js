import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ODOO_URL ||= "http://127.0.0.1:1";
const { B2C_SETTINGS, getB2CSettingDefault, parseB2CSetting, OG_IMAGE_CHOICES, BRAND_IMAGE_CHOICES } = await import("../src/b2c-settings-defaults.js");
const { DEFAULT_SOCIAL_LINKS, mergeSocialLinks, fetchSocialLinks } = await import("../src/social-links.js");

test("seo : défaut = textes actuels (null) et image de partage actuelle", () => {
  assert.deepEqual(getB2CSettingDefault("seo"), {
    title: { fr: null, en: null, es: null, pt: null },
    description: { fr: null, en: null, es: null, pt: null },
    ogImage: "hero/hero-1",
  });
  assert.equal(B2C_SETTINGS.seo.key, "smalto.b2c.seo");
  assert.ok(B2C_SETTINGS.seo.public);
});

test("seo : validation (longueurs, image parmi les choix)", () => {
  const ok = B2C_SETTINGS.seo.validate({ title: { en: " Maison Smalto " }, description: {}, ogImage: "brand/storytelling" });
  assert.equal(ok.title.en, "Maison Smalto");
  assert.equal(ok.title.fr, null);
  assert.throws(() => B2C_SETTINGS.seo.validate({ ogImage: "hero/hero-9" }), /Image de partage/);
  assert.throws(() => B2C_SETTINGS.seo.validate({ ogImage: "hero/hero-1", title: { fr: "x".repeat(71) } }), /Titre SEO/);
  assert.ok(OG_IMAGE_CHOICES.includes("hero/hero-1") && OG_IMAGE_CHOICES.includes("brand/histoire-fondation"));
});

test("accueil : visuels éditoriaux par défaut = images actuelles, fusion d'une ancienne valeur sans ce champ", () => {
  assert.deepEqual(getB2CSettingDefault("home").editorialImages, {
    histoire: "histoire-fondation", savoirFaire: ["atelier-coupe", "atelier-couture", "atelier-finition"], boutique: "collection-2",
  });
  // Valeur enregistrée avant l'ajout du champ : les visuels par défaut s'appliquent.
  const parsed = parseB2CSetting("home", JSON.stringify({ heroImages: ["hero-2"], slideDurationMs: 4000 }));
  assert.deepEqual(parsed.heroImages, ["hero-2"]);
  assert.deepEqual(parsed.editorialImages, getB2CSettingDefault("home").editorialImages);
});

test("accueil : visuels éditoriaux validés (3 vignettes, images existantes)", () => {
  const base = getB2CSettingDefault("home");
  assert.throws(() => B2C_SETTINGS.home.validate({ ...base, editorialImages: { ...base.editorialImages, savoirFaire: ["atelier-coupe"] } }), /exactement 3/);
  assert.throws(() => B2C_SETTINGS.home.validate({ ...base, editorialImages: { ...base.editorialImages, boutique: "photo-inconnue" } }), /Visuel Boutique/);
  const v = B2C_SETTINGS.home.validate({ ...base, editorialImages: { histoire: "histoire-moderne", savoirFaire: ["savoir-dessin", "savoir-matieres", "atelier-cuir"], boutique: "collection-1" } });
  assert.equal(v.editorialImages.histoire, "histoire-moderne");
  assert.ok(BRAND_IMAGE_CHOICES.every((n) => /^[a-z0-9-]+$/.test(n)));
});

test("réseaux sociaux : fusion avec la réponse B2B", () => {
  assert.deepEqual(mergeSocialLinks(null), DEFAULT_SOCIAL_LINKS);
  assert.deepEqual(mergeSocialLinks({ facebook: "", instagram: "", linkedin: "" }).map((l) => l.name), ["YouTube"]);
  assert.equal(mergeSocialLinks({ instagram: "https://www.instagram.com/autre" })[1].href, "https://www.instagram.com/autre");
  assert.equal(mergeSocialLinks({ facebook: "javascript:alert(1)" })[0].href, DEFAULT_SOCIAL_LINKS[0].href);
});

test("réseaux sociaux : lecture du B2B, repli sur les valeurs par défaut", async () => {
  const ok = async (url) => ({ ok: true, json: async () => ({ social: { linkedin: "" } }), url });
  assert.deepEqual((await fetchSocialLinks({ fetchImpl: ok })).map((l) => l.name), ["Facebook", "Instagram", "YouTube"]);
  assert.deepEqual(await fetchSocialLinks({ fetchImpl: async () => ({ ok: false }) }), DEFAULT_SOCIAL_LINKS);
  assert.deepEqual(await fetchSocialLinks({ fetchImpl: async () => { throw new Error("down"); } }), DEFAULT_SOCIAL_LINKS);
});
