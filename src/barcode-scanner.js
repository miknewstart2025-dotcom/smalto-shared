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
//
// Douchette Bluetooth : la liaison peut marquer un court arrêt. Un « Entrée »
// un peu en retard termine quand même le scan ; un code coupé en deux par un
// arrêt est signalé (« misread ») au lieu d'être pris pour un autre code ou
// ignoré sans bruit : la page demande alors de rescanner.

export const SCAN_DEFAULTS = { minLength: 6, maxGapMs: 100 };

// « Entrée » accepté jusqu'à ce délai après le dernier caractère (× maxGapMs).
const LATE_ENTER = 3;
// Début de code abandonné par un arrêt : au moins 3 chiffres tapés vite.
const isCodeStart = (s) => s.length >= 3 && /^\d+$/.test(s);

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
  let broken = ""; // début d'un code coupé par un arrêt
  return {
    // key : caractère (keyFromEvent) ou « Enter » / « Tab » ; at : horodatage en ms.
    // Renvoie { type: "scan", code } | { type: "misread", code } | { type: "start" }
    // | { type: "char" } | { type: "ignore" }.
    push(key, at) {
      const gap = at - last;
      last = at;
      if (key === "Enter" || key === "Tab") {
        const code = buffer, head = broken;
        buffer = "";
        broken = "";
        // Le code entier est tapé vite (sinon il serait coupé) : seul
        // « Entrée » peut arriver un peu en retard.
        if (!code || gap > maxGapMs * LATE_ENTER) return { type: "ignore" };
        if (head) return { type: "misread", code: head + code };
        return code.length >= minLength ? { type: "scan", code } : { type: "ignore" };
      }
      if (typeof key !== "string" || key.length !== 1) return { type: "ignore" };
      if (!buffer || gap > maxGapMs) {
        // Arrêt au milieu d'un code : la suite n'est pas un code à elle seule.
        broken = buffer && gap <= maxGapMs * LATE_ENTER && isCodeStart(buffer) ? broken + buffer : "";
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
      if (at - last <= maxGapMs || !/^\d+$/.test(buffer)) return { type: "ignore" };
      if (broken) {
        const code = broken + buffer;
        buffer = "";
        broken = "";
        return { type: "misread", code };
      }
      if (buffer.length < minLength) return { type: "ignore" };
      const code = buffer;
      buffer = "";
      return { type: "scan", code };
    },
    reset() { buffer = ""; last = 0; broken = ""; },
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

// onScan(code) ; options.onMisread(code) : code coupé, à rescanner.
// Renvoie la fonction qui débranche l'écoute.
export function listenForScans(onScan, options = {}) {
  if (typeof window === "undefined") return () => {};
  const detector = createScanDetector(options);
  const maxGapMs = options.maxGapMs ?? SCAN_DEFAULTS.maxGapMs;
  let field = null;
  let before = "";
  let timer = null;
  const done = (code, misread = false) => {
    if (field && field.value !== before) restoreField(field, before);
    field = null;
    if (misread) options.onMisread?.(code);
    else onScan(code);
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
        if (idle.type === "scan" || idle.type === "misread") done(idle.code, idle.type === "misread");
      }, maxGapMs * 2);
    } else if (r.type === "scan" || r.type === "misread") {
      e.preventDefault();
      e.stopPropagation();
      done(r.code, r.type === "misread");
    }
  };
  window.addEventListener("keydown", onKey, true);
  return () => { clearTimeout(timer); window.removeEventListener("keydown", onKey, true); };
}
