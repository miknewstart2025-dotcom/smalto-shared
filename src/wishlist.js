import { odooCall } from "./odoo-core.js";
import crypto from "crypto";

// Logique wishlist partagée B2B/B2C — seul le préfixe de clé de stockage
// (ir.config_parameter) diffère entre les deux apps, d'où la factory.
export function createWishlistHandlers(namespace) {
  const KEY_FOR   = (pid) => `smalto.${namespace}.wishlist.${pid}`;
  const SHARE_KEY = (tok) => `smalto.${namespace}.wishlist.share.${tok}`;

  async function load(partnerId) {
    try {
      const raw = await odooCall("ir.config_parameter", "get_param", [KEY_FOR(partnerId)]);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  async function save(partnerId, items) {
    await odooCall("ir.config_parameter", "set_param", [KEY_FOR(partnerId), JSON.stringify(items)]);
  }

  async function getWishlist(req, res) {
    try {
      res.json({ items: await load(req.user.partnerId) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  async function addToWishlist(req, res) {
    try {
      const { productId, productName, imageUrl, categ, price, variantId, notes } = req.body;
      if (!productId) return res.status(400).json({ error: "productId requis" });

      const items = await load(req.user.partnerId);
      const exists = items.find(i => i.productId === productId && (i.variantId ?? null) === (variantId ?? null));
      if (exists) return res.json({ items, item: exists, alreadyExists: true });

      const item = {
        id: crypto.randomUUID(),
        productId: Number(productId),
        productName: productName || "",
        imageUrl: imageUrl || null,
        categ: categ || null,
        price: price || 0,
        variantId: variantId || null,
        notes: notes || null,
        addedAt: new Date().toISOString(),
      };
      items.unshift(item);
      await save(req.user.partnerId, items);
      res.json({ items, item });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  async function updateWishlistItem(req, res) {
    try {
      const items = await load(req.user.partnerId);
      const idx = items.findIndex(i => i.id === req.params.itemId);
      if (idx === -1) return res.status(404).json({ error: "Item introuvable" });
      items[idx] = { ...items[idx], notes: req.body.notes ?? items[idx].notes };
      await save(req.user.partnerId, items);
      res.json({ items, item: items[idx] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  async function removeFromWishlist(req, res) {
    try {
      const items = await load(req.user.partnerId);
      const filtered = items.filter(i => i.id !== req.params.itemId);
      await save(req.user.partnerId, filtered);
      res.json({ items: filtered });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  async function createShareLink(req, res) {
    try {
      const items = await load(req.user.partnerId);
      if (!items.length) return res.status(400).json({ error: "Votre sélection est vide" });
      const token = crypto.randomBytes(20).toString("hex");
      await odooCall("ir.config_parameter", "set_param", [
        SHARE_KEY(token),
        JSON.stringify({ items, createdAt: new Date().toISOString() }),
      ]);
      res.json({ token });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  async function getSharedWishlist(req, res) {
    try {
      const raw = await odooCall("ir.config_parameter", "get_param", [SHARE_KEY(req.params.token)]);
      if (!raw) return res.status(404).json({ error: "Sélection introuvable ou expirée" });
      const { items, createdAt } = JSON.parse(raw);
      res.json({ items, createdAt });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  return {
    getWishlist,
    addToWishlist,
    updateWishlistItem,
    removeFromWishlist,
    createShareLink,
    getSharedWishlist,
  };
}
