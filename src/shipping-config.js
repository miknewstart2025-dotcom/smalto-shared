import { odooCall } from "./odoo-core.js";

// Seuil de livraison gratuite B2C (montant + activation), géré depuis
// l'admin B2B, consommé par le site B2C. Stocké dans Odoo comme le réglage
// newsletter, pour rester la source de vérité partagée entre les deux apps.
const CONFIG_KEY = "smalto.b2c.free_shipping_threshold";

const DEFAULT_CONFIG = { enabled: true, threshold: 200 };

export async function getShippingConfig() {
  try {
    const raw = await odooCall("ir.config_parameter", "get_param", [CONFIG_KEY]);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setShippingConfig(data) {
  const threshold = Number(data.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 10000) {
    throw new Error("Le montant doit être compris entre 1 et 10000€.");
  }
  const config = { enabled: !!data.enabled, threshold };
  await odooCall("ir.config_parameter", "set_param", [CONFIG_KEY, JSON.stringify(config)]);
  return config;
}
