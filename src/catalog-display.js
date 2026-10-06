// Affichage du catalogue, commun au site B2B, à l'Admin et à l'application
// de prise de commande (orders.smalto.com) : ordre des tailles et des
// couleurs, couleur d'affichage d'un coloris.

const LETTER_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"];

// Trie les tailles par ordre croissant : numérique (38, 40, 42… ou pointures)
// si toutes les valeurs sont des nombres, sinon par l'échelle lettres
// (XS < S < M < L < XL…), sinon alphabétique en dernier recours. L'ordre
// brut renvoyé par Odoo (product.attribute.value) ne reflète que l'ordre de
// création des valeurs, pas un ordre logique.
export function sortSizes(sizes) {
  const allNumeric = sizes.every((s) => /^\d+([.,]\d+)?$/.test(s.trim()));
  if (allNumeric) {
    return [...sizes].sort((a, b) => parseFloat(a.replace(",", ".")) - parseFloat(b.replace(",", ".")));
  }
  return [...sizes].sort((a, b) => {
    const ia = LETTER_SIZE_ORDER.indexOf(a.trim().toUpperCase());
    const ib = LETTER_SIZE_ORDER.indexOf(b.trim().toUpperCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, "fr");
  });
}

// Trie les couleurs par ordre alphabétique (locale FR).
export function sortColors(colors) {
  return [...colors].sort((a, b) => a.localeCompare(b, "fr"));
}

// Palette de correspondance nom de couleur (FR, tel qu'utilisé dans Odoo) → hex,
// pour afficher un rond de couleur réelle plutôt que le libellé texte.
const COLOR_HEX_MAP = {
  BLANC: "#FFFFFF", IVOIRE: "#F3EEE3", ECRU: "#EDE6D6", CREME: "#F0E6D2",
  NOIR: "#0D0D0D", ANTHRACITE: "#33363B",
  GRIS: "#9B9B93", "GRIS CLAIR": "#C9C9C1", "GRIS ANTHRACITE": "#4A4C50", ARGENT: "#C6C6C6",
  BEIGE: "#D8C7A8", SABLE: "#D6C39F", TAUPE: "#8B7D6B", CAMEL: "#C08A4E",
  TABAC: "#8A5A34", TABACCO: "#8A5A34", MARRON: "#5A3E2B", CHOCOLAT: "#4A2E1E", VISON: "#6E5A46",
  MARINE: "#1B2A4A", NAVY: "#1B2A4A", BLEU: "#3B5B92", "BLEU CIEL": "#A9C6E8",
  "BLEU MARINE": "#1B2A4A", INDIGO: "#3E4C7A", TURQUOISE: "#3FA9A0",
  VERT: "#4B6043", "VERT BOUTEILLE": "#2F4A3C", KAKI: "#6B6650", OLIVE: "#6B6B3D",
  BORDEAUX: "#5C1A24", ROUGE: "#B23A32", ROSE: "#E3B7B0", SAUMON: "#E39C8B", CORAIL: "#E17A62",
  JAUNE: "#D9B450", MOUTARDE: "#C9A227", ORANGE: "#C97A3D",
  VIOLET: "#5B4470", PRUNE: "#4A2A3A", OR: "#C9A64A", DORE: "#C9A64A",
};

// Renvoie un hex approximatif pour un nom de couleur (insensible à la casse/accents),
// ou null si inconnu — l'appelant doit alors afficher un rond neutre/placeholder.
export function colorSwatchHex(name) {
  const key = String(name || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, ""); // enlève les accents
  return COLOR_HEX_MAP[key] ?? null;
}
