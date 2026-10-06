import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanDetector } from "../src/barcode-scanner.js";

// Tape une suite de touches, `gap` ms entre chacune ; renvoie le dernier résultat.
function type(detector, keys, gap, start = 1000) {
  let t = start, r;
  for (const k of keys) { t += gap; r = detector.push(k, t); }
  return { r, t };
}

test("douchette : un code tapé très vite puis Entrée est un scan", () => {
  const d = createScanDetector();
  const { r } = type(d, [..."3760012345678", "Enter"], 8);
  assert.deepEqual(r, { type: "scan", code: "3760012345678" });
});

test("douchette : une frappe humaine n'est pas un scan", () => {
  const d = createScanDetector();
  const { r } = type(d, [..."3760012345678", "Enter"], 140);
  assert.deepEqual(r, { type: "ignore" });
});

test("douchette : un code trop court est ignoré", () => {
  const d = createScanDetector();
  assert.deepEqual(type(d, [..."123", "Enter"], 5).r, { type: "ignore" });
});

test("douchette : une frappe humaine juste avant ne pollue pas le scan suivant", () => {
  const d = createScanDetector();
  const first = type(d, [..."abc"], 200);
  const { r } = type(d, [..."40012345", "Enter"], 10, first.t + 400);
  assert.deepEqual(r, { type: "scan", code: "40012345" });
});

test("douchette : touches spéciales ignorées, Tab termine aussi un scan", () => {
  const d = createScanDetector({ minLength: 4 });
  assert.deepEqual(d.push("Shift", 1), { type: "ignore" });
  assert.deepEqual(type(d, [..."ABC123", "Tab"], 5).r, { type: "scan", code: "ABC123" });
});
