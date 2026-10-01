// Réglages du site B2C pilotés depuis la page « Paramètres » de l'admin B2B
// et stockés dans Odoo (ir.config_parameter), comme newsletter.js et
// shipping-config.js. Ce fichier ne dépend pas d'Odoo : valeurs par défaut,
// validation et fusion sont importables côté navigateur (formulaire admin
// B2B, repli d'affichage B2C). Lecture/écriture Odoo : b2c-settings.js.
//
// Les valeurs par défaut reproduisent exactement l'affichage B2C au moment
// de l'introduction de ces réglages : une clé absente d'Odoo ne change rien.

export const LOCALES = ["fr", "en", "es", "pt"];

// Pages où la popup newsletter peut s'ouvrir (premier segment d'URL).
export const POPUP_PAGE_CHOICES = ["catalogue", "collections", "produit"];

// Visuels du slider d'accueil disponibles dans le déploiement B2C
// (public/hero/<nom>.avif|.webp|.jpg) — l'admin choisit et ordonne parmi
// ceux-ci, il ne peut pas en ajouter (pas d'envoi de fichier).
export const HERO_IMAGE_CHOICES = ["hero-1", "hero-2", "hero-3", "hero-4"];

// Photos de marque disponibles dans le déploiement B2C (public/brand/<nom>.jpg)
// pour les blocs éditoriaux de l'accueil — choix parmi celles-ci uniquement.
export const BRAND_IMAGE_CHOICES = [
  "atelier-coupe", "atelier-couture", "atelier-cuir", "atelier-finition",
  "collection-1", "collection-2", "hero-main", "histoire-fondation",
  "histoire-moderne", "savoir-dessin", "savoir-matieres", "storytelling",
];

// Image de partage (Open Graph / réseaux sociaux) : un visuel du slider ou
// une photo de marque, au format "<dossier>/<nom>" → /<dossier>/<nom>.jpg.
export const OG_IMAGE_CHOICES = [
  ...HERO_IMAGE_CHOICES.map((n) => `hero/${n}`),
  ...BRAND_IMAGE_CHOICES.map((n) => `brand/${n}`),
];

function editorialImages(data) {
  const e = data && typeof data === "object" ? data : {};
  const savoirFaire = Array.isArray(e.savoirFaire) ? e.savoirFaire : [];
  if (savoirFaire.length !== 3) throw new Error("Visuels Savoir-faire : exactement 3 images.");
  return {
    histoire: brandImage(e.histoire, "Visuel Histoire"),
    savoirFaire: savoirFaire.map((v, i) => brandImage(v, `Visuel Savoir-faire n°${i + 1}`)),
    boutique: brandImage(e.boutique, "Visuel Boutique"),
  };
}

function brandImage(value, label) {
  if (!BRAND_IMAGE_CHOICES.includes(value)) {
    throw new Error(`${label} : image à choisir parmi ${BRAND_IMAGE_CHOICES.join(", ")}.`);
  }
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Revendeurs agréés (store locator B2C, page revendeurs B2B). Coordonnées
// GPS facultatives : sans lat/lng, le B2C place le point au centre de la
// ville s'il la connaît, sinon ne l'affiche pas sur la carte.
const DEFAULT_RETAIL_PARTNERS = [
  { name: "Artextyl", city: "Paris", postalCode: "75016", country: "France" },
  { name: "Sarl Travelling — Casting & L'Homme", address: "2 Place Chabaneau", city: "Montpellier", postalCode: "34000", country: "France" },
  { name: "Come Back Sarl", address: "54, avenue de Clichy", city: "Paris", postalCode: "75018", country: "France" },
  { name: "C3 — Christophe Coutin", address: "27 rue Blatin", city: "Clermont-Ferrand", postalCode: "63000", country: "France" },
  { name: "Gentry (Rastignac)", address: "25 rue des 3 Cailloux", city: "Amiens", postalCode: "80000", country: "France" },
  { name: "Guy Koskas", city: "Paris", postalCode: "75016", country: "France" },
  { name: "Marciano SAS", address: "2 Place de la Porte Maillot", city: "Paris", postalCode: "75017", country: "France" },
  { name: "Octavien Diffusion", address: "20 Place de la Cathédrale", city: "Colmar", postalCode: "68000", country: "France" },
  { name: "Showroom Smalto", address: "9 avenue d'Eylau", city: "Paris", postalCode: "75016", country: "France" },
  { name: "Saint Hilaire", address: "130 Boulevard de Clichy", city: "Paris", postalCode: "75018", country: "France" },
  { name: "Sarl J N L (Theo Fil)", address: "110 avenue Victor Hugo", city: "Paris", postalCode: "75016", country: "France" },
  { name: "Sam Mercure Int of Monaco", address: "17 avenue Albert II", city: "Monaco", postalCode: "98000", country: "Monaco" },
  { name: "Abenis & Fils", city: "Abidjan", country: "Côte d'Ivoire" },
  { name: "Bachou Boutik", address: "21/22 Mermoz Pyrotechnique", city: "Abidjan", country: "Côte d'Ivoire" },
  { name: "Emeraude", city: "Abidjan", country: "Côte d'Ivoire" },
  { name: "Essentiel", address: "Cocody Riviera Palmeraie", city: "Abidjan", country: "Côte d'Ivoire" },
  { name: "Houdrouge", address: "Boulevard Botreau Roussel", city: "Abidjan", country: "Côte d'Ivoire" },
  { name: "Ara Trading", address: "Cité Khemisti", city: "Oran", postalCode: "31026", country: "Algérie" },
  { name: "Chic Congo Brazzaville", address: "Centre Ville, Immeuble CNS", city: "Brazzaville", country: "Congo" },
  { name: "Chic Congo Pointe-Noire", address: "Centre Ville, Avenue Charles de Gaulle", city: "Pointe-Noire", country: "Congo" },
  { name: "Eclat Plus", address: "Avenue des Écuries N°34", city: "Kinshasa", country: "Congo" },
  { name: "GCH Hospitality Sarl", address: "265 Boulevard Zerktouni N°92", city: "Casablanca", country: "Maroc" },
  { name: "Seves", address: "Angle Avenue Annakhil & Boulevard Addolb", city: "Rabat", country: "Maroc" },
  { name: "La Maison Balmain", city: "Yaoundé", country: "Cameroun" },
];

// ── Helpers de validation ────────────────────────────────────────────────────
// Chaque validateur renvoie la valeur normalisée ou lève une Error dont le
// message est affichable tel quel dans l'admin.

function int(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} : nombre entier entre ${min} et ${max} attendu.`);
  }
  return n;
}

function amount(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} : montant entre ${min} et ${max} € attendu.`);
  }
  return Math.round(n * 100) / 100;
}

function text(value, max, label, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} : texte de 1 à ${max} caractères attendu.`);
  }
  if (/[<>]/.test(value)) throw new Error(`${label} : les caractères < et > ne sont pas autorisés.`);
  return value.trim();
}

function email(value, label, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(v) || v.length > 254) throw new Error(`${label} : adresse email invalide.`);
  return v;
}

// Texte par langue : null = traduction intégrée au site (aucun changement).
function localized(value, max, label) {
  const src = value && typeof value === "object" ? value : {};
  return Object.fromEntries(LOCALES.map((l) => [l, text(src[l], max, `${label} (${l})`, { optional: true })]));
}

function object(data) {
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

// ── Définition des réglages ──────────────────────────────────────────────────

export const B2C_SETTINGS = {
  newsletterPopup: {
    key: "smalto.b2c.newsletter_popup",
    public: true,
    default: { delaySeconds: 15, dismissDays: 30, subscribedDays: 365, pages: ["catalogue", "collections", "produit"] },
    validate(data) {
      const d = object(data);
      const pages = Array.isArray(d.pages) ? [...new Set(d.pages)] : [];
      if (!pages.length || pages.some((p) => !POPUP_PAGE_CHOICES.includes(p))) {
        throw new Error(`Pages de la popup : au moins une parmi ${POPUP_PAGE_CHOICES.join(", ")}.`);
      }
      return {
        delaySeconds: int(d.delaySeconds, 0, 300, "Délai d'ouverture (s)"),
        dismissDays: int(d.dismissDays, 1, 365, "Masquée après fermeture (jours)"),
        subscribedDays: int(d.subscribedDays, 1, 730, "Masquée après inscription (jours)"),
        pages: POPUP_PAGE_CHOICES.filter((p) => pages.includes(p)),
      };
    },
  },

  home: {
    key: "smalto.b2c.home",
    public: true,
    default: {
      heroImages: ["hero-1", "hero-2", "hero-3", "hero-4"],
      slideDurationMs: 3000,
      shippingBanner: { fr: null, en: null, es: null, pt: null },
      // Blocs éditoriaux sous le slider : Histoire (plein cadre),
      // Savoir-faire (3 vignettes, dans l'ordre), Boutique.
      editorialImages: {
        histoire: "histoire-fondation",
        savoirFaire: ["atelier-coupe", "atelier-couture", "atelier-finition"],
        boutique: "collection-2",
      },
    },
    validate(data) {
      const d = object(data);
      const images = Array.isArray(d.heroImages) ? d.heroImages : [];
      if (!images.length || images.length > HERO_IMAGE_CHOICES.length || images.some((i) => !HERO_IMAGE_CHOICES.includes(i)) || new Set(images).size !== images.length) {
        throw new Error(`Visuels du slider : 1 à ${HERO_IMAGE_CHOICES.length} visuels distincts parmi ${HERO_IMAGE_CHOICES.join(", ")}.`);
      }
      return {
        heroImages: images,
        slideDurationMs: int(d.slideDurationMs, 1000, 30000, "Durée d'une image du slider (ms)"),
        shippingBanner: localized(d.shippingBanner, 200, "Bannière livraison"),
        editorialImages: editorialImages(d.editorialImages),
      };
    },
  },

  // SEO par défaut (page d'accueil et pages sans texte propre). null = texte
  // actuel des traductions du site (messages/*.json → meta.title /
  // meta.description). ogImage : image de partage par défaut.
  seo: {
    key: "smalto.b2c.seo",
    public: true,
    default: {
      title: { fr: null, en: null, es: null, pt: null },
      description: { fr: null, en: null, es: null, pt: null },
      ogImage: "hero/hero-1",
    },
    validate(data) {
      const d = object(data);
      if (!OG_IMAGE_CHOICES.includes(d.ogImage)) {
        throw new Error(`Image de partage : à choisir parmi ${OG_IMAGE_CHOICES.join(", ")}.`);
      }
      return {
        title: localized(d.title, 70, "Titre SEO"),
        description: localized(d.description, 200, "Description SEO"),
        ogImage: d.ogImage,
      };
    },
  },

  // Livraison standard France : toujours gratuite (politique commerciale),
  // donc non réglable ici. Le seuil smalto.b2c.free_shipping_threshold
  // (shipping-config.js) n'est pas utilisé par le site B2C.
  shippingRates: {
    key: "smalto.b2c.shipping_rates",
    public: true,
    default: { europe: 19.9, world: 29.9, express: 15, premium: 25 },
    validate(data) {
      const d = object(data);
      return {
        europe: amount(d.europe, 0, 500, "Livraison standard Europe"),
        world: amount(d.world, 0, 500, "Livraison standard reste du monde"),
        express: amount(d.express, 0, 500, "Livraison express"),
        premium: amount(d.premium, 0, 500, "Livraison premium"),
      };
    },
  },

  // Emails transactionnels B2C. null = comportement actuel (variables
  // d'environnement RESEND_FROM / SMALTO_CC_EMAIL, pas de reply-to).
  // Non public : jamais renvoyé au navigateur.
  emails: {
    key: "smalto.b2c.emails",
    public: false,
    default: { fromName: null, replyTo: null, internalCc: null, signature: "Maison Francesco Smalto — Paris" },
    validate(data) {
      const d = object(data);
      const fromName = text(d.fromName, 60, "Nom d'expéditeur", { optional: true });
      if (fromName && /["\n\r]/.test(fromName)) throw new Error("Nom d'expéditeur : guillemets et retours à la ligne interdits.");
      return {
        fromName,
        replyTo: email(d.replyTo, "Adresse de réponse", { optional: true }),
        internalCc: email(d.internalCc, "Copie interne", { optional: true }),
        signature: text(d.signature, 200, "Signature"),
      };
    },
  },

  // Boutique Maison Smalto (44 rue François 1er) — distincte du showroom B2B
  // exposé par /settings/public. Le siège social (mentions légales) n'est
  // volontairement pas réglable ici.
  boutique: {
    key: "smalto.b2c.boutique",
    public: true,
    default: {
      street: "44 rue François 1er",
      postalCode: "75008",
      city: "Paris",
      country: "France",
      phone: "+33 (0)1 84 74 34 31",
      email: "contact@smalto.fr",
      hours: "Lundi au samedi : 11h – 19h",
    },
    validate(data) {
      const d = object(data);
      const phone = text(d.phone, 40, "Téléphone");
      if (!/^\+?[\d\s().-]{6,}$/.test(phone)) throw new Error("Téléphone : format international attendu (ex. +33 (0)1 84 74 34 31).");
      return {
        street: text(d.street, 100, "Adresse"),
        postalCode: text(d.postalCode, 20, "Code postal"),
        city: text(d.city, 80, "Ville"),
        country: text(d.country, 60, "Pays"),
        phone,
        email: email(d.email, "Email"),
        hours: text(d.hours, 200, "Horaires"),
      };
    },
  },

  // Clé commune B2B/B2C (pas de préfixe b2c).
  retailPartners: {
    key: "smalto.retail_partners",
    public: true,
    default: DEFAULT_RETAIL_PARTNERS,
    validate(data) {
      if (!Array.isArray(data) || data.length > 500) throw new Error("Revendeurs : liste de 0 à 500 entrées attendue.");
      return data.map((p, i) => {
        const d = object(p);
        const label = `Revendeur n°${i + 1}`;
        const out = { name: text(d.name, 120, `${label}, nom`) };
        const address = text(d.address, 200, `${label}, adresse`, { optional: true });
        if (address) out.address = address;
        out.city = text(d.city, 80, `${label}, ville`);
        const postalCode = text(d.postalCode, 20, `${label}, code postal`, { optional: true });
        if (postalCode) out.postalCode = postalCode;
        out.country = text(d.country, 60, `${label}, pays`);
        const hasLat = d.lat !== undefined && d.lat !== null && d.lat !== "";
        const hasLng = d.lng !== undefined && d.lng !== null && d.lng !== "";
        if (hasLat !== hasLng) throw new Error(`${label} : latitude et longitude vont ensemble.`);
        if (hasLat) {
          const lat = Number(d.lat), lng = Number(d.lng);
          if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw new Error(`${label} : coordonnées GPS invalides.`);
          }
          out.lat = lat;
          out.lng = lng;
        }
        return out;
      });
    },
  },
};

export const B2C_SETTING_NAMES = Object.keys(B2C_SETTINGS);

export function getB2CSettingDefault(name) {
  const def = B2C_SETTINGS[name];
  if (!def) throw new Error(`Réglage B2C inconnu : ${name}`);
  return structuredClone(def.default);
}

// Valeur stockée (chaîne JSON Odoo, ou false/absente) → réglage complet.
// Les objets sont fusionnés sur les valeurs par défaut (un champ ajouté plus
// tard garde sa valeur par défaut) ; une valeur illisible ou devenue
// invalide (édition manuelle dans Odoo) retombe entièrement sur le défaut.
export function parseB2CSetting(name, raw) {
  const def = B2C_SETTINGS[name];
  if (!def) throw new Error(`Réglage B2C inconnu : ${name}`);
  if (!raw) return getB2CSettingDefault(name);
  try {
    const stored = JSON.parse(raw);
    if (Array.isArray(def.default)) return def.validate(stored);
    const merged = { ...def.default, ...object(stored) };
    for (const [k, v] of Object.entries(def.default)) {
      if (v && typeof v === "object" && !Array.isArray(v)) merged[k] = { ...v, ...object(stored?.[k]) };
    }
    return def.validate(merged);
  } catch {
    return getB2CSettingDefault(name);
  }
}

// Numéro affiché → lien tel: ("+33 (0)1 84 74 34 31" → "tel:+33184743431").
export function phoneHref(phone) {
  const cleaned = String(phone || "").replace(/\(0\)/g, "");
  const plus = cleaned.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${cleaned.replace(/\D/g, "")}`;
}
