import { Resend } from "resend";

const SMALTO_FROM = process.env.RESEND_FROM || "Maison Smalto <noreply@smalto.com>";
// digital@smalto.fr est systématiquement en copie de TOUS les emails sortants,
// quel que soit le site (B2B/B2C) ou le flux d'origine (commande, inscription,
// mot de passe, contact...) — demande explicite Maison Smalto pour un suivi
// centralisé de la boîte digital.
const DIGITAL_CC = process.env.DIGITAL_CC_EMAIL || "digital@smalto.fr";
// TEST_EMAIL override tous les destinataires — utilisé tant que le domaine
// d'envoi Resend n'est pas pleinement vérifié en production.
const TEST_EMAIL = process.env.RESEND_TEST_EMAIL || null;

let _resend = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// `fromName` remplace uniquement le nom affiché de l'expéditeur : l'adresse
// reste celle de RESEND_FROM (domaine vérifié chez Resend).
export function buildFrom(fromName, defaultFrom = SMALTO_FROM) {
  if (!fromName) return defaultFrom;
  const address = defaultFrom.match(/<([^>]+)>/)?.[1] || defaultFrom.trim();
  return `${String(fromName).replace(/["<>\r\n]/g, "").trim()} <${address}>`;
}

// `source` identifie la provenance de l'envoi dans le sujet — ex: "B2B-COMMANDE",
// "B2C-INSCRIPTION", "B2B-RELANCE-FACTURE" — pour repérer immédiatement d'où
// vient un email dans digital@smalto.fr, qui reçoit une copie de tout.
// `cc` permet d'ajouter des copies additionnelles (ex: contact@smalto.com déjà
// en place) sans jamais remplacer la copie digital@smalto.fr obligatoire.
// `fromName` : voir buildFrom ci-dessus.
export async function sendEmail({ to, subject, body_html, reply_to = null, attachments = [], source = null, cc = [], fromName = null }) {
  const effectiveTo = TEST_EMAIL ? [TEST_EMAIL] : [to];
  const extraCc = (Array.isArray(cc) ? cc : [cc]).filter(Boolean);
  const effectiveCc = TEST_EMAIL ? [] : [...new Set([DIGITAL_CC, ...extraCc])];
  const testPrefix = TEST_EMAIL ? `[TEST → ${to}] ` : "";
  const sourcePrefix = source ? `[${source}] ` : "";

  const payload = {
    from: buildFrom(fromName),
    to: effectiveTo,
    ...(effectiveCc.length ? { cc: effectiveCc } : {}),
    subject: `${testPrefix}${sourcePrefix}${subject}`,
    html: body_html,
    ...(attachments.length ? { attachments } : {}),
  };
  if (reply_to) payload.reply_to = reply_to;

  const { data, error } = await getResend().emails.send(payload);
  if (error) throw new Error(error.message || "Email send failed");
  return data?.id;
}
