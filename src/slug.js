// Génération de slugs produit lisibles, partagée entre b2b-smalto et b2c-smalto.
// Format: "<nom-normalisé>-<id>" — l'ID en suffixe permet de résoudre le produit
// sans base de correspondance slug↔id, et de rediriger vers le slug canonique
// si le nom a changé depuis (cf. usage dans produit/[id]/page.tsx).
export function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function productSlug(product) {
  return `${slugify(product.name)}-${product.id}`;
}

export function idFromProductSlug(slug) {
  const match = slug.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}
