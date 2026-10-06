import { test } from "node:test";
import assert from "node:assert/strict";
import { orderTotals, combinedDiscount, lineAmount, toPct, toAmount, exceedsDiscountCap } from "../src/order-pricing.js";
import { sortSizes, sortColors, colorSwatchHex } from "../src/catalog-display.js";

test("remise combinée : ligne puis globale", () => {
  assert.equal(combinedDiscount(10, 5), 14.5);
  assert.equal(combinedDiscount(0, 7.5), 7.5);
  assert.equal(combinedDiscount("12,5", 0), 12.5);
  assert.equal(combinedDiscount(150, 0), 100);
});

test("montant de ligne arrondi au centime, saisies françaises acceptées", () => {
  assert.equal(lineAmount(3, 341, 0), 1023);
  assert.equal(lineAmount(2, "61,30", 10), 110.34);
  assert.equal(toPct("abc"), 0);
  assert.equal(toAmount("1 386,50"), 1386.5);
});

test("totaux : remise globale = écart avant/après, exactement comme Odoo", () => {
  const lines = [{ qty: 3, unitPrice: 341, discountPct: 0 }, { qty: 5, unitPrice: 61, discountPct: 10 }];
  const t = orderTotals(lines, { globalDiscountPct: 5, vatRate: 20 });
  assert.equal(t.pieces, 8);
  assert.equal(t.subtotal, 1297.5);           // 1023 + 274,50
  assert.equal(t.untaxed, 1232.63);            // 971,85 + 260,78 (remise combinée 14,5 %)
  assert.equal(t.globalAmount, 64.87);
  assert.equal(t.vat, 246.53);
  assert.equal(t.total, 1479.16);
  assert.equal(t.maxDiscount, 10);
});

test("plafond de remise : ligne ou globale", () => {
  const lines = [{ qty: 1, unitPrice: 100, discountPct: 12 }];
  assert.equal(exceedsDiscountCap(lines, 0, 10), true);
  assert.equal(exceedsDiscountCap([{ qty: 1, unitPrice: 100 }], 10, 10), false);
  assert.equal(exceedsDiscountCap([{ qty: 1, unitPrice: 100 }], 10.5, 10), true);
});

test("affichage : tailles et couleurs dans l'ordre, couleur d'un coloris", () => {
  assert.deepEqual(sortSizes(["52", "46", "50"]), ["46", "50", "52"]);
  assert.deepEqual(sortSizes(["XL", "S", "3XL", "M"]), ["S", "M", "XL", "3XL"]);
  assert.deepEqual(sortColors(["NAVY", "BEIGE"]), ["BEIGE", "NAVY"]);
  assert.equal(colorSwatchHex("navy"), "#1B2A4A");
  assert.equal(colorSwatchHex("Doré"), "#C9A64A");
  assert.equal(colorSwatchHex("INCONNU"), null);
});

test("arrondi au centime identique à Odoo (moitié vers le haut)", async () => {
  const { round2 } = await import("../src/order-pricing.js");
  assert.equal(round2(260.775), 260.78);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(0), 0);
});
