import { odooCall } from "./odoo-core.js";

// Clé API Google Maps (store locator B2C), gérée depuis l'admin B2B,
// consommée par le site B2C. Stockée dans Odoo (comme le seuil de livraison
// gratuite et la config newsletter) plutôt qu'en variable d'environnement,
// pour être modifiable sans redéploiement.
const CONFIG_KEY = "smalto.google_maps_api_key";

export async function getMapsApiKey() {
  try {
    const val = await odooCall("ir.config_parameter", "get_param", [CONFIG_KEY]);
    return val || null;
  } catch {
    return null;
  }
}

export async function setMapsApiKey(apiKey) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  await odooCall("ir.config_parameter", "set_param", [CONFIG_KEY, key]);
  return { apiKey: key || null };
}
