import { odooCall } from "./odoo-core.js";
import { B2C_SETTINGS, B2C_SETTING_NAMES, getB2CSettingDefault, parseB2CSetting } from "./b2c-settings-defaults.js";

// Lecture/écriture Odoo des réglages B2C définis dans b2c-settings-defaults.js
// (clés, formats, valeurs par défaut, validation). Même stockage que
// newsletter.js / shipping-config.js : un JSON par clé ir.config_parameter.
export * from "./b2c-settings-defaults.js";

function definition(name) {
  const def = B2C_SETTINGS[name];
  if (!def) throw new Error(`Réglage B2C inconnu : ${name}`);
  return def;
}

// Un réglage. Odoo injoignable → valeur par défaut (le site reste affiché).
export async function getB2CSetting(name, { call = odooCall } = {}) {
  const def = definition(name);
  try {
    const raw = await call("ir.config_parameter", "get_param", [def.key]);
    return parseB2CSetting(name, raw);
  } catch {
    return getB2CSettingDefault(name);
  }
}

// Tous les réglages en un seul appel Odoo. `publicOnly` exclut ceux qui ne
// doivent jamais partir au navigateur (emails).
export async function getB2CSettings({ call = odooCall, publicOnly = false } = {}) {
  const names = B2C_SETTING_NAMES.filter((n) => !publicOnly || B2C_SETTINGS[n].public);
  let rows = [];
  try {
    rows = await call("ir.config_parameter", "search_read",
      [[["key", "in", names.map((n) => B2C_SETTINGS[n].key)]]],
      { fields: ["key", "value"] }
    ) || [];
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(names.map((n) => [n, parseB2CSetting(n, byKey.get(B2C_SETTINGS[n].key))]));
}

// Valide puis enregistre. Lève une Error au message affichable si la valeur
// est invalide — rien n'est écrit dans ce cas.
export async function setB2CSetting(name, data, { call = odooCall } = {}) {
  const def = definition(name);
  const value = def.validate(data);
  await call("ir.config_parameter", "set_param", [def.key, JSON.stringify(value)]);
  return value;
}
