const express = require('express');
const { db, now } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/sales  { skuNumber OR skuId, quantity }
router.post('/', authRequired, (req, res) => {
  const { skuNumber, skuId, quantity } = req.body || {};
  const qty = Number(quantity || 0);
  if ((!skuNumber && !skuId) || !qty || qty < 1) {
    return res.status(400).json({ error: 'skuNumber or skuId and positive quantity required' });
  }

  const sku = skuId
    ? db.prepare('SELECT id, price FROM skus WHERE id=?').get(skuId)
    : db.prepare('SELECT id, price FROM skus WHERE number=?').get(skuNumber);

  if (!sku) return res.status(404).json({ error: 'sku not found' });

  const total = Number((sku.price * qty).toFixed(2));
  const ins = db.prepare('INSERT INTO sales (userId, skuId, quantity, total, createdAt) VALUES (?,?,?,?,?)');
  const { lastInsertRowid } = ins.run(req.user.id, sku.id, qty, total, now());

  res.status(201).json({ id: Number(lastInsertRowid), skuId: sku.id, quantity: qty, total });
});

// GET /api/sales (mine)
router.get('/', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.quantity, s.total, s.createdAt,
           sk.number AS skuNumber, sk.name AS skuName, sk.price AS skuPrice
    FROM sales s
    JOIN skus sk ON sk.id = s.skuId
    WHERE s.userId = ?
    ORDER BY s.id DESC
  `).all(req.user.id);
  res.json(rows);
});

module.exports = router;
