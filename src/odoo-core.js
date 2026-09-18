// Client XML-RPC Odoo générique, partagé entre b2b-smalto et b2c-smalto.
// La logique d'authentification applicative (rôles, hash de mot de passe...)
// reste dans le odoo.js de chaque app — seul le transport RPC est commun ici.
import xmlrpc from "xmlrpc";

const URL = process.env.ODOO_URL;
const DB = process.env.ODOO_DB;
const USER = process.env.ODOO_USER;
const API_KEY = process.env.ODOO_API_KEY;

const parsed = new globalThis.URL(URL);
const isHttps = parsed.protocol === "https:";
const host = parsed.hostname;
const port = parsed.port ? parseInt(parsed.port) : isHttps ? 443 : 80;

export function makeClient(path) {
  const opts = { host, port, path };
  return isHttps ? xmlrpc.createSecureClient(opts) : xmlrpc.createClient(opts);
}

let _adminUid = null;

export async function rpc(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, val) => {
      if (err) reject(err);
      else resolve(val);
    });
  });
}

export async function getAdminUid() {
  if (_adminUid) return _adminUid;
  const common = makeClient("/xmlrpc/2/common");
  const uid = await rpc(common, "authenticate", [DB, USER, API_KEY, {}]);
  if (!uid) throw new Error("Odoo admin authentication failed");
  _adminUid = uid;
  return uid;
}

export async function odooCall(model, method, args, kwargs = {}) {
  const uid = await getAdminUid();
  const client = makeClient("/xmlrpc/2/object");
  // lang par défaut fr_FR : plusieurs champs (ex. product.template.name) sont
  // traduisibles et Odoo renvoie sinon la traduction "de base" (souvent en
  // anglais, parfois divergente du libellé FR réellement utilisé/affiché
  // dans l'UI par l'équipe) — sans ce défaut, deux fiches identiques en FR
  // peuvent sembler des doublons, ou une vraie divergence FR/EN passer
  // inaperçue. Reste surchargeable via kwargs.context.lang.
  const defaultContext = (method === "write" || method === "create" || method === "unlink")
    ? { lang: "fr_FR", tracking_disable: true, mail_notrack: true }
    : { lang: "fr_FR" };
  const kw = { ...kwargs, context: { ...defaultContext, ...(kwargs.context || {}) } };

  // Retry avec backoff exponentiel sur rate-limit Odoo (erreur HTML 500 → "H1")
  const delays = [3000, 8000, 20000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await rpc(client, "execute_kw", [DB, uid, API_KEY, model, method, args, kw]);
    } catch (err) {
      const isRateLimit = err?.message?.includes("H1") || err?.message?.includes("Too Many");
      if (!isRateLimit || attempt >= delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

// Compute pricelist price for a product.product variant (qty=1)
export async function getPricelistPrice(pricelistId, productVariantId, partnerId) {
  if (!pricelistId || !productVariantId) return null;
  try {
    const price = await odooCall(
      "product.pricelist",
      "get_product_price",
      [[pricelistId], productVariantId, 1.0, partnerId],
      {}
    );
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}
