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

// Compte les produits par catégorie pour un domaine donné. Odoo SaaS n'expose
// pas read_group via XML-RPC ("does not exist" — pas dans l'allowlist), donc on
// compte côté client à partir d'un seul search_read plutôt qu'un search_count
// par catégorie (qui déclenche le rate-limit Odoo au-delà d'une vingtaine de
// catégories). Le domaine doit refléter exactement les mêmes filtres que le
// catalogue affiché, sinon une catégorie peut apparaître ici avec un nombre de
// produits qui tombe à zéro une fois sur la page catalogue réelle.
export async function computeCategoryCounts(domain) {
  const products = await odooCall("product.template", "search_read", [domain], {
    fields: ["categ_id"], limit: 2000,
  });
  const counts = new Map();
  for (const p of products || []) {
    if (!p.categ_id) continue;
    const [id, name] = p.categ_id;
    const entry = counts.get(id) || { id, name, complete_name: name, product_count: 0 };
    entry.product_count += 1;
    counts.set(id, entry);
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

// Résout une catégorie (id Odoo — préféré — ou nom en repli) vers l'ensemble
// des IDs de catégories-feuilles à filtrer sur les produits. Nécessaire
// depuis l'introduction de la hiérarchie parent/enfant : un clic sur
// "Accessoires" ou "Vestes & Manteaux" doit remonter tous les produits des
// sous-catégories, pas seulement ceux taggés exactement sur ce nom (les
// parents eux-mêmes ne portent jamais de produit).
//
// Le nom reste accepté pour la compatibilité (anciens liens partagés/indexés,
// paramètre déjà en base) mais ne doit plus être ce sur quoi le frontend se
// base pour construire un lien — un chemin complet ("Vêtements Homme /
// Chemises & Polos / CHEMISE") au lieu du nom de la feuille seule ne matche
// jamais ici et renvoie silencieusement 0 résultat. Le vrai id Odoo
// (product.categ_id[0] côté produit, node.id dans l'arbre catégories) est
// sans ambiguïté et doit être préféré partout où il est disponible.
export async function resolveCategoryDescendantIds(categoryIdOrName) {
  const isId = typeof categoryIdOrName === "number" || /^\d+$/.test(String(categoryIdOrName ?? ""));
  let rootId;
  if (isId) {
    rootId = parseInt(categoryIdOrName, 10);
  } else {
    // Comparaison insensible à la casse (=ilike) car les catégories réelles
    // sont en MAJUSCULES alors que les parents/groupes sont en French Case.
    const matches = await odooCall("product.category", "search_read",
      [[["name", "=ilike", categoryIdOrName]]],
      { fields: ["id"], limit: 1 }
    );
    if (!matches.length) return [];
    rootId = matches[0].id;
  }

  const allIds = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await odooCall("product.category", "search_read",
      [[["parent_id", "in", frontier]]],
      { fields: ["id"] }
    );
    if (!children.length) break;
    const childIds = children.map((c) => c.id);
    allIds.push(...childIds);
    frontier = childIds;
  }
  return allIds;
}

// Construit l'arborescence catégories parentes → enfants pour la navigation
// premium (mega-menu, page catégories), à partir des mêmes comptages que
// computeCategoryCounts mais en résolvant le vrai parent_id de chaque
// catégorie feuille (categ_id[1] renvoyé par Odoo est le complete_name
// "Parent / Sous-parent / Feuille", pas le nom court — il faut donc relire
// product.category séparément pour connaître name/parent_id de chaque noeud).
// Ne remonte que les branches ayant au moins un produit ; les catégories
// sans parent restant flat (ex: BLAZER si isolée) sont renvoyées telles quelles.
export async function computeCategoryTree(domain) {
  const products = await odooCall("product.template", "search_read", [domain], {
    fields: ["categ_id"], limit: 2000,
  });

  const leafCounts = new Map(); // categId -> product_count
  for (const p of products || []) {
    if (!p.categ_id) continue;
    const id = p.categ_id[0];
    leafCounts.set(id, (leafCounts.get(id) || 0) + 1);
  }
  if (!leafCounts.size) return [];

  // Charge tout l'arbre product.category (petite table, <50 lignes) pour
  // pouvoir remonter les ancêtres de chaque feuille comptée.
  const allCats = await odooCall("product.category", "search_read", [[]], {
    fields: ["id", "name", "parent_id"],
  });
  const byId = new Map(allCats.map((c) => [c.id, c]));

  const nodes = new Map(); // categId -> { id, name, product_count, children: Map }
  const getNode = (id) => {
    if (!nodes.has(id)) {
      const cat = byId.get(id);
      nodes.set(id, { id, name: cat?.name || `#${id}`, product_count: 0, children: new Map() });
    }
    return nodes.get(id);
  };

  const roots = new Map(); // categId -> node (top-level, parent_id = false)

  for (const [leafId, count] of leafCounts) {
    const leafCat = byId.get(leafId);
    if (!leafCat) continue;

    // Remonte la chaîne de parents jusqu'à la racine, en créditant le
    // compte à chaque niveau (un parent affiche le total de ses enfants).
    let current = leafCat;
    let currentNode = getNode(current.id);
    currentNode.product_count += count;

    while (current.parent_id) {
      const parentId = current.parent_id[0];
      const parentCat = byId.get(parentId);
      if (!parentCat) break;
      const parentNode = getNode(parentId);
      parentNode.product_count += count;
      parentNode.children.set(current.id, currentNode);
      current = parentCat;
      currentNode = parentNode;
    }
    // `current` est maintenant la racine de cette branche
    roots.set(current.id, currentNode);
  }

  const toArray = (node) => ({
    id: node.id,
    name: node.name,
    product_count: node.product_count,
    ...(node.children.size
      ? { children: [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, "fr")).map(toArray) }
      : {}),
  });

  return [...roots.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map(toArray);
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
      // Fusionnées par nom (comme les couleurs) — des doublons d'ID existent en
      // base pour une même taille, ce qui produisait deux entrées "37" et cassait
      // React (clés dupliquées) côté catalogue.
      const mergedSizeCounts = new Map(); // name -> count
      for (const v of values) {
        const count = valueCounts.get(v.id) || 0;
        if (count <= 0) continue;
        mergedSizeCounts.set(v.name, (mergedSizeCounts.get(v.name) || 0) + count);
      }
      sizeFacets = [...mergedSizeCounts.entries()]
        .map(([value, count]) => ({ value, count }))
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
