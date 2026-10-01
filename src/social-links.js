// Réseaux sociaux du site B2C (pied de page, JSON-LD sameAs, emails).
// Instagram, Facebook et LinkedIn sont pilotés par l'admin B2B
// (GET {B2B_API_URL}/settings/public → social) ; YouTube n'existe pas côté
// B2B et reste local. Sans dépendance Odoo : importable côté navigateur.

export const DEFAULT_SOCIAL_LINKS = [
  { name: "Facebook", href: "https://www.facebook.com/MaisonSmalto" },
  { name: "Instagram", href: "https://www.instagram.com/smaltoparis" },
  { name: "YouTube", href: "https://www.youtube.com/user/francescosmalto" },
  { name: "LinkedIn", href: "https://www.linkedin.com/company/francesco-smalto-international" },
];

const B2B_SOCIAL_KEYS = { Facebook: "facebook", Instagram: "instagram", LinkedIn: "linkedin" };

export const DEFAULT_B2B_API_URL = "https://b2b-smalto-api.vercel.app";

// Applique la réponse B2B aux liens par défaut, dans l'ordre par défaut.
// Clé absente (B2B en panne, champ manquant) ou URL non https → valeur par
// défaut ; chaîne vide → réseau masqué (contrat du endpoint B2B).
export function mergeSocialLinks(remote, defaults = DEFAULT_SOCIAL_LINKS) {
  const social = remote && typeof remote === "object" ? remote : {};
  const links = [];
  for (const link of defaults) {
    const key = B2B_SOCIAL_KEYS[link.name];
    const value = key ? social[key] : undefined;
    if (typeof value !== "string") {
      links.push({ name: link.name, href: link.href });
    } else if (!value.trim()) {
      // réseau masqué
    } else if (/^https:\/\//.test(value.trim())) {
      links.push({ name: link.name, href: value.trim() });
    } else {
      links.push({ name: link.name, href: link.href });
    }
  }
  return links;
}

// Lecture du endpoint B2B, jamais bloquante : panne ou lenteur (> timeoutMs)
// → liens par défaut. `fetchOptions` permet au front Next.js de passer
// { next: { revalidate: 60 } }.
export async function fetchSocialLinks({
  baseUrl = DEFAULT_B2B_API_URL, timeoutMs = 3000, fetchOptions = {}, fetchImpl = globalThis.fetch,
} = {}) {
  try {
    const res = await fetchImpl(`${baseUrl}/settings/public`, { ...fetchOptions, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return mergeSocialLinks(null);
    const data = await res.json();
    return mergeSocialLinks(data?.social);
  } catch {
    return mergeSocialLinks(null);
  }
}
