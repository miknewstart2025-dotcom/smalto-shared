// Douchette (lecteur de codes-barres Bluetooth ou USB) : elle se comporte
// comme un clavier qui tape le code très vite puis « Entrée ». On la
// distingue d'une frappe humaine par la vitesse entre deux touches, comme
// Odoo. Commun à l'Admin (entrepôt) et à l'application Commandes.
//
// - createScanDetector : détection pure (testée), sans navigateur ;
// - listenForScans : branchement sur la page. Si le curseur était dans un
//   champ de saisie, les caractères du code y sont effacés (le champ retrouve
//   sa valeur d'avant le scan) et « Entrée » n'y est pas transmis.

export const SCAN_DEFAULTS = { minLength: 6, maxGapMs: 50 };

export function createScanDetector({ minLength = SCAN_DEFAULTS.minLength, maxGapMs = SCAN_DEFAULTS.maxGapMs } = {}) {
  let buffer = "";
  let last = 0;
  return {
    // key : KeyboardEvent.key ; at : horodatage en ms.
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
  let field = null;
  let before = "";
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const r = detector.push(e.key, e.timeStamp || performance.now());
    if (r.type === "start") {
      field = isField(document.activeElement) ? document.activeElement : null;
      // Valeur avant le 1er caractère du code (la touche n'est pas encore saisie).
      before = field ? field.value : "";
    } else if (r.type === "scan") {
      e.preventDefault();
      e.stopPropagation();
      if (field && field.value !== before) restoreField(field, before);
      field = null;
      onScan(r.code);
    }
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
