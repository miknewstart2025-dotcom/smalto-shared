// Prix et remises d'une commande B2B, communs à l'application de prise de
// commande (affichage immédiat sur la tablette, même hors ligne) et à l'API
// (recalcul de contrôle avant l'envoi dans Odoo) : un seul calcul, jamais
// deux versions qui divergent.
//
// Règles :
// - prix unitaire HT : prix B2B du produit, modifiable par le vendeur ;
// - remise de ligne en % ;
// - remise globale en % sur le devis : appliquée à chaque ligne, en plus de
//   sa remise propre (1 − (1 − ligne) × (1 − globale)), parce qu'Odoo ne
//   connaît que la remise par ligne. Le total est donc exactement celui
//   qu'Odoo calculera ; le montant de la remise globale est la différence
//   entre le total avant et après remise globale ;
// - arrondi au centime par ligne, comme Odoo.

// Arrondi au centime comme Odoo (float_round, ROUND_HALF_UP) : la valeur en
// centimes reçoit une correction proportionnelle à sa grandeur avant
// l'arrondi, pour que 260,775 donne 260,78 malgré la représentation binaire
// (260,774999…) — sinon le total affiché sur la tablette différerait d'un
// centime de celui d'Odoo.
export function round2(n) {
  const v = Number(n) * 100;
  if (!Number.isFinite(v) || v === 0) return 0;
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  const eps = Math.pow(2, Math.log2(abs) - 52);
  return (sign * Math.round(abs + eps)) / 100;
}

// Pourcentage borné entre 0 et 100 ; « 12,5 » accepté.
export function toPct(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

// Montant positif ; « 341,50 » accepté.
export function toAmount(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Remise effective d'une ligne une fois la remise globale appliquée (4 décimales).
export function combinedDiscount(linePct, globalPct) {
  const l = toPct(linePct) / 100;
  const g = toPct(globalPct) / 100;
  return Math.round((1 - (1 - l) * (1 - g)) * 1000000) / 10000;
}

export function lineAmount(qty, unitPrice, discountPct) {
  return round2((Number(qty) || 0) * toAmount(unitPrice) * (1 - toPct(discountPct) / 100));
}

// lines : [{ qty, unitPrice, discountPct }] ; vatRate en % (20 en France,
// 0 en autoliquidation intracommunautaire ou à l'export) — indicatif : la TVA
// définitive est celle de la position fiscale du client dans Odoo.
export function orderTotals(lines, { globalDiscountPct = 0, vatRate = 0 } = {}) {
  let pieces = 0;
  let subtotal = 0; // après remises de ligne
  let untaxed = 0; // après remise globale (= total HT Odoo)
  let maxDiscount = toPct(globalDiscountPct);
  for (const l of lines || []) {
    pieces += Number(l.qty) || 0;
    subtotal += lineAmount(l.qty, l.unitPrice, l.discountPct);
    untaxed += lineAmount(l.qty, l.unitPrice, combinedDiscount(l.discountPct, globalDiscountPct));
    maxDiscount = Math.max(maxDiscount, toPct(l.discountPct));
  }
  subtotal = round2(subtotal);
  untaxed = round2(untaxed);
  const vat = round2((untaxed * toPct(vatRate)) / 100);
  return { pieces, subtotal, globalAmount: round2(subtotal - untaxed), untaxed, vat, total: round2(untaxed + vat), maxDiscount };
}

// Une remise (de ligne ou globale) dépasse-t-elle le plafond du vendeur ?
export function exceedsDiscountCap(lines, globalDiscountPct, capPct) {
  return orderTotals(lines, { globalDiscountPct }).maxDiscount > toPct(capPct) + 1e-9;
}
