// Douchette (lecteur de codes-barres Bluetooth ou USB) : elle se comporte
// comme un clavier qui tape le code très vite puis (en général) « Entrée ».
// On la distingue d'une frappe humaine par la vitesse entre deux touches,
// comme Odoo. Commun à l'Admin (entrepôt) et à l'application Commandes.
//
// Clavier : une douchette tape comme un clavier américain (QWERTY). Sur une
// tablette ou un PC réglé en français (AZERTY), la touche « 3 » devient « " »,
// « 6 » devient « § »… On lit donc la touche physique (KeyboardEvent.code,
// indépendant de la langue du clavier) et non le caractère produit.
//
// - keyFromEvent, createScanDetector : logique pure (testée) ;
// - listenForScans : branchement sur la page. Si le curseur était dans un
//   champ de saisie, les caractères du code y sont effacés (le champ retrouve
//   sa valeur d'avant le scan) et « Entrée » n'y est pas transmis.

export const SCAN_DEFAULTS = { minLength: 6, maxGapMs: 100 };

const CODE_CHARS = { Minus: "-", Period: ".", Slash: "/", Space: " ", NumpadSubtract: "-", NumpadDecimal: ".", NumpadDivide: "/" };

// Touche physique → caractère d'un clavier américain (ce que la douchette
// voulait taper), quelle que soit la langue du clavier de l'appareil.
export function keyFromEvent({ code, key, shiftKey }) {
  if (code === "Enter" || code === "NumpadEnter") return "Enter";
  if (code === "Tab") return "Tab";
  let m = /^(?:Digit|Numpad)(\d)$/.exec(code || "");
  if (m) return m[1];
  m = /^Key([A-Z])$/.exec(code || "");
  if (m) return shiftKey ? m[1] : m[1].toLowerCase();
  if (CODE_CHARS[code]) return CODE_CHARS[code];
  return key;
}

export function createScanDetector({ minLength = SCAN_DEFAULTS.minLength, maxGapMs = SCAN_DEFAULTS.maxGapMs } = {}) {
  let buffer = "";
  let last = 0;
  return {
    // key : caractère (keyFromEvent) ou « Enter » / « Tab » ; at : horodatage en ms.
    // Renvoie { type: "scan", code } | { type: "start" } | { type: "char" } | { type: "ignore" }.
    push(key, at) {
      const gap = at - last;
      last = at;
      if (key === "Enter" || key === "Tab") {
        const code = buffer;
        buffer = "";
        return gap <= maxGapMs && code.length >= minLength ? { type: "scan", code } : { type: "ignore" };
      }
      if (typeof key !== "string" || key.length !== 1) return { type: "ignore" };
      if (!buffer || gap > maxGapMs) {
        buffer = key;
        return { type: "start" };
      }
      buffer += key;
      return { type: "char" };
    },
    // Douchette réglée sans « Entrée » final : un code uniquement numérique
    // (EAN…) tapé très vite puis suivi d'un silence est aussi un scan. Limité
    // aux chiffres pour ne jamais prendre un mot tapé vite pour un scan.
    idle(at) {
      if (at - last <= maxGapMs || buffer.length < minLength || !/^\d+$/.test(buffer)) return { type: "ignore" };
      const code = buffer;
      buffer = "";
      return { type: "scan", code };
    },
    reset() { buffer = ""; last = 0; },
  };
}

const isField = (el) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");

// Remet la valeur d'un champ en prévenant React (setter natif + événement).
function restoreField(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// onScan(code) ; renvoie la fonction qui débranche l'écoute.
export function listenForScans(onScan, options = {}) {
  if (typeof window === "undefined") return () => {};
  const detector = createScanDetector(options);
  const maxGapMs = options.maxGapMs ?? SCAN_DEFAULTS.maxGapMs;
  let field = null;
  let before = "";
  let timer = null;
  const done = (code) => {
    if (field && field.value !== before) restoreField(field, before);
    field = null;
    onScan(code);
  };
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    clearTimeout(timer);
    const r = detector.push(keyFromEvent(e), e.timeStamp || performance.now());
    if (r.type === "start") {
      field = isField(document.activeElement) ? document.activeElement : null;
      // Valeur avant le 1er caractère du code (la touche n'est pas encore saisie).
      before = field ? field.value : "";
    }
    if (r.type === "start" || r.type === "char") {
      timer = setTimeout(() => {
        const idle = detector.idle(performance.now());
        if (idle.type === "scan") done(idle.code);
      }, maxGapMs * 2);
    } else if (r.type === "scan") {
      e.preventDefault();
      e.stopPropagation();
      done(r.code);
    }
  };
  window.addEventListener("keydown", onKey, true);
  return () => { clearTimeout(timer); window.removeEventListener("keydown", onKey, true); };
}
