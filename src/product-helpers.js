import { odooCall } from "./odoo-core.js";

// Logique catalogue partagée entre b2b-smalto et b2c-smalto. Ce qui reste
// spécifique à chaque app (tarification pricelist vs prix retail public,
// flag de publication x_publie_b2b/x_publie_b2c, domaine de recherche) vit
// dans le products.js de chaque repo, qui appelle ces helpers.

export const EXCLUDED_CATEGORIES = ["TISSU", "Services", "Expenses", "Deliveries", "Goods"];

// Des doublons de valeurs d'attribut couleur existent en base (ex: "BLEU" créé
// plusieurs fois via différents imports). On normalise pour les fusionner à
// l'affichage/au filtrage plutôt que de dépendre d'un ID unique par couleur.
export function normalizeColorName(s) {
  return (s || "").trim().toUpperCase();
}

export function odooImageUrl(model, id, field = "image_512") {
  return `${process.env.ODOO_URL}/web/image/${model}/${id}/${field}`;
}

export function extractPrimaryMaterial(composition) {
  if (!composition) return null;
  const c = composition.toUpperCase();
  if (/CASHMERE|CACHEMIRE/.test(c)) return "Cachemire";
  if (/LEATHER|SUEDE|CUIR/.test(c)) return "Cuir / Suède";
  if (/SILK|\bSE\b/.test(c) && !/DESIGN/.test(c)) return "Soie";
  if (/LAINE|WOOL|\bWV\b/.test(c)) return "Laine";
  if (/LINEN|\bLIN\b/.test(c)) return "Lin";
  if (/COTON|COTTON|\bCO\b/.test(c)) return "Coton";
  if (/POLYAMIDE|\bPA\b/.test(c)) return "Polyamide";
  if (/POLYESTER|\bPES\b/.test(c)) return "Polyester";
  return null;
}

export async function resolveAttrIdsByName(pattern) {
  const attrs = await odooCall("product.attribute", "search_read",
    [[["name", "=ilike", `%${pattern}%`]]],
    { fields: ["id"] }
  );
  return attrs.map((a) => a.id);
}

// Résout les IDs de template correspondant à un filtre couleur (comparaison
// normalisée pour absorber les doublons de casse en base). Retourne `null`
// si aucun filtre demandé, un Set (éventuellement vide) sinon.
export async function resolveColorFilterIds(colors) {
  if (!colors?.length) return null;
  const colorAttrIds = await resolveAttrIdsByName("couleur");
  if (!colorAttrIds.length) return new Set();
  const wantedColors = new Set(colors.map(normalizeColorName));
  const attrValues = await odooCall("product.attribute.value", "search_read",
    [[["attribute_id", "in", colorAttrIds]]],
    { fields: ["id", "name"] }
  );
  const valueIds = attrValues.filter((v) => wantedColors.has(normalizeColorName(v.name))).map((v) => v.id);
  if (!valueIds.length) return new Set();
  const lines = await odooCall("product.template.attribute.line", "search_read",
    [[["attribute_id", "in", colorAttrIds], ["value_ids", "in", valueIds]]],
    { fields: ["product_tmpl_id"] }
  );
  return new Set(lines.map((l) => l.product_tmpl_id[0]));
}

// Résout les IDs de template correspondant à un filtre taille (comparaison exacte).
export async function resolveSizeFilterIds(sizes) {
  if (!sizes?.length) return null;
  const sizeAttrIds = await resolveAttrIdsByName("taille");
  if (!sizeAttrIds.length) return new Set();
  const attrValues = await odooCall("product.attribute.value", "search_read",
    [[["attribute_id", "in", sizeAttrIds], ["name", "in", sizes]]],
    { fields: ["id"] }
  );
  const valueIds = attrValues.map((v) => v.id);
  if (!valueIds.length) return new Set();
  const lines = await odooCall("product.template.attribute.line", "search_read",
    [[["attribute_id", "in", sizeAttrIds], ["value_ids", "in", valueIds]]],
    { fields: ["product_tmpl_id"] }
  );
  return new Set(lines.map((l) => l.product_tmpl_id[0]));
}

// Calcule les facettes couleur/taille/composition pour un domaine de recherche
// donné (déjà filtré par flag de publication / catégories exclues par l'appelant).
export async function computeProductFacets(baseDomain) {
  const products = await odooCall("product.template", "search_read", [baseDomain], {
    fields: ["id", "x_composition", "attribute_line_ids"],
    limit: 2000,
  });
  if (!products.length) return { colors: [], sizes: [], compositions: [] };

  const allLineIds = products.flatMap((p) => p.attribute_line_ids || []);
  let colorFacets = [];
  let sizeFacets = [];

  if (allLineIds.length) {
    const allLines = await odooCall("product.template.attribute.line", "read", [allLineIds], {
      fields: ["product_tmpl_id", "attribute_id", "value_ids"],
    });
    const attrIds = [...new Set(allLines.map((l) => l.attribute_id[0]))];
    const attrs = await odooCall("product.attribute", "read", [attrIds], { fields: ["id", "name"] });

    const sizeAttrIds = new Set(
      attrs.filter((a) => /taille|pointure|size/i.test(a.name)).map((a) => a.id)
    );
    const colorAttrId = attrs.find((a) => /couleur|color/i.test(a.name))?.id;
    const colorLines = colorAttrId ? allLines.filter((l) => l.attribute_id[0] === colorAttrId) : [];
    const sizeLines = allLines.filter((l) => sizeAttrIds.has(l.attribute_id[0]));

    // Color facets — fusionnées par nom normalisé car des doublons d'ID
    // existent en base pour une même couleur (ex: plusieurs "BLEU").
    const colorValueIds = [...new Set(colorLines.flatMap((l) => l.value_ids))];
    if (colorValueIds.length) {
      const values = await odooCall("product.attribute.value", "read", [colorValueIds], { fields: ["id", "name"] });
      const valueCounts = new Map();
      for (const line of colorLines) for (const vid of line.value_ids) valueCounts.set(vid, (valueCounts.get(vid) || 0) + 1);
      const mergedCounts = new Map(); // normalizedName -> { display, count }
      for (const v of values) {
        const key = normalizeColorName(v.name);
        if (!key) continue;
        const count = valueCounts.get(v.id) || 0;
        if (count <= 0) continue;
        const existing = mergedCounts.get(key);
        if (existing) existing.count += count;
        else mergedCounts.set(key, { display: key, count });
      }
      colorFacets = [...mergedCounts.values()]
        .map(({ display, count }) => ({ value: display, count }))
        .sort((a, b) => a.value.localeCompare(b.value, "fr"));
    }

    const sizeValueIds = [...new Set(sizeLines.flatMap((l) => l.value_ids))];
    if (sizeValueIds.length) {
      const values = await odooCall("product.attribute.value", "read", [sizeValueIds], { fields: ["id", "name"] });
      const valueCounts = new Map();
      for (const line of sizeLines) for (const vid of line.value_ids) valueCounts.set(vid, (valueCounts.get(vid) || 0) + 1);
      sizeFacets = values
        .map((v) => ({ value: v.name, count: valueCounts.get(v.id) || 0 }))
        .filter((v) => v.count > 0)
        .sort((a, b) => {
          const na = parseFloat(a.value), nb = parseFloat(b.value);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.value.localeCompare(b.value, "fr");
        });
    }
  }

  const compCounts = new Map();
  for (const p of products) {
    const mat = extractPrimaryMaterial(p.x_composition);
    if (mat) compCounts.set(mat, (compCounts.get(mat) || 0) + 1);
  }
  const compositionFacets = [...compCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return { colors: colorFacets, sizes: sizeFacets, compositions: compositionFacets };
}

// Regroupe une liste de product.image (déjà chargée par l'appelant) par
// couleur, à partir du nom de l'enregistrement (ex: "[B2B] Bleu Marine").
export function buildGalleryByColor(mediaImgs, templateId) {
  const cleanMediaName = (n = "") => n.replace(/^\[(B2B|B2C)\] ?/i, "").trim();

  const byColor = {};
  for (const img of mediaImgs) {
    const color = cleanMediaName(img.name) || "default";
    if (!byColor[color]) byColor[color] = { images: [], videos: [] };
    if (img.video_url || img.name?.startsWith("__blob_video__:")) {
      const vUrl = img.name?.startsWith("__blob_video__:") ? img.name.slice("__blob_video__:".length) : img.video_url;
      byColor[color].videos.push(vUrl);
    } else {
      byColor[color].images.push(odooImageUrl("product.image", img.id, "image_1920"));
    }
  }

  const firstColor = Object.values(byColor)[0];
  return {
    gallery_by_color: byColor,
    gallery_images: firstColor?.images?.length
      ? firstColor.images
      : [odooImageUrl("product.template", templateId, "image_1920")],
    gallery_videos: firstColor?.videos || [],
  };
}

// Construit les médias (images/vidéos) d'une variante à partir des
// product.image déjà chargés pour cette variante.
export function buildVariantMedia(records) {
  return (records || []).map((rec) => {
    if (rec.name?.startsWith("__blob_video__:")) {
      return { id: rec.id, name: rec.name, image_url: null, video_url: rec.name.slice("__blob_video__:".length) };
    }
    const vUrl = rec.video_url || null;
    const isBlobImage = vUrl && /\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(vUrl);
    return {
      id: rec.id,
      name: rec.name,
      image_url: isBlobImage ? vUrl : (vUrl ? null : odooImageUrl("product.image", rec.id, "image_1920")),
      video_url: vUrl && !isBlobImage ? vUrl : null,
    };
  });
}
