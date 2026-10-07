import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanDetector, keyFromEvent } from "../src/barcode-scanner.js";

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

// Clavier français (AZERTY) sur un Mac ou un iPad : la rangée des chiffres
// produit « & é " ' ( § è ! ç à » sans Majuscule.
const AZERTY_MAC = { 1: "&", 2: "é", 3: '"', 4: "'", 5: "(", 6: "§", 7: "è", 8: "!", 9: "ç", 0: "à" };

test("douchette : clavier français, le code lu est celui de la douchette (touche physique)", () => {
  const d = createScanDetector();
  let t = 1000, r;
  for (const digit of "3667497000189") {
    t += 8;
    r = d.push(keyFromEvent({ code: `Digit${digit}`, key: AZERTY_MAC[digit], shiftKey: false }), t);
  }
  r = d.push(keyFromEvent({ code: "Enter", key: "Enter", shiftKey: false }), t + 8);
  assert.deepEqual(r, { type: "scan", code: "3667497000189" });
});

test("douchette : lettres et pavé numérique lus d'après la touche physique", () => {
  assert.equal(keyFromEvent({ code: "KeyQ", key: "a", shiftKey: false }), "q"); // AZERTY : A ↔ Q
  assert.equal(keyFromEvent({ code: "KeyA", key: "Q", shiftKey: true }), "A");
  assert.equal(keyFromEvent({ code: "Numpad7", key: "7", shiftKey: false }), "7");
  assert.equal(keyFromEvent({ code: "NumpadEnter", key: "Enter", shiftKey: false }), "Enter");
  assert.equal(keyFromEvent({ code: "Minus", key: ")", shiftKey: false }), "-");
});

test("douchette sans « Entrée » final : code numérique suivi d'un silence = scan", () => {
  const d = createScanDetector();
  const { t } = type(d, [..."3667497000189"], 9);
  assert.deepEqual(d.idle(t + 50), { type: "ignore" });          // encore en cours
  assert.deepEqual(d.idle(t + 250), { type: "scan", code: "3667497000189" });
});

test("douchette sans « Entrée » : un mot tapé vite n'est jamais pris pour un scan", () => {
  const d = createScanDetector();
  const { t } = type(d, [..."pantalon"], 30);
  assert.deepEqual(d.idle(t + 300), { type: "ignore" });
});

test("douchette Bluetooth un peu lente (70 ms entre deux touches) : toujours un scan", () => {
  const d = createScanDetector();
  assert.deepEqual(type(d, [..."3667497000189", "Enter"], 70).r, { type: "scan", code: "3667497000189" });
});

test("douchette Bluetooth : « Entrée » un peu en retard termine quand même le scan", () => {
  const d = createScanDetector();
  const { t } = type(d, [..."3667497000189"], 8);
  assert.deepEqual(d.push("Enter", t + 150), { type: "scan", code: "3667497000189" });
});

test("douchette : « Entrée » très tardif (frappe humaine) ignoré", () => {
  const d = createScanDetector();
  const { t } = type(d, [..."pantalon"], 30);
  assert.deepEqual(d.push("Enter", t + 1500), { type: "ignore" });
});

test("douchette Bluetooth : code coupé par un arrêt signalé, ni ignoré ni pris pour un autre code", () => {
  const d = createScanDetector();
  const first = type(d, [..."3667497"], 8);
  const { r } = type(d, [..."000189", "Enter"], 8, first.t + 150 - 8);
  assert.deepEqual(r, { type: "misread", code: "3667497000189" });
  // la suite trop courte pour être un code est signalée aussi
  const second = type(d, [..."36674970001"], 8, 5000);
  assert.deepEqual(type(d, [..."89", "Enter"], 8, second.t + 150 - 8).r, { type: "misread", code: "3667497000189" });
  // le scan suivant est normal
  assert.deepEqual(type(d, [..."3760012345678", "Enter"], 8, 9000).r, { type: "scan", code: "3760012345678" });
});

test("douchette sans « Entrée » : code coupé puis silence = misread", () => {
  const d = createScanDetector();
  const first = type(d, [..."3667497"], 8);
  const { t } = type(d, [..."0001"], 8, first.t + 150 - 8);
  assert.deepEqual(d.idle(t + 250), { type: "misread", code: "36674970001" });
});

test("douchette : frappe humaine lente avant un scan, pas de faux « misread »", () => {
  const d = createScanDetector();
  const first = type(d, [..."123"], 150);
  assert.deepEqual(type(d, [..."3760012345678", "Enter"], 8, first.t + 120).r, { type: "scan", code: "3760012345678" });
});
