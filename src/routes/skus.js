const express = require('express');
const { db } = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/skus  -> list all SKUs
router.get('/', authRequired, (req, res) => {
  const rows = db.prepare('SELECT id, number, name, price FROM skus ORDER BY id').all();
  res.json(rows);
});

// POST /api/skus  (admin) -> add SKU
router.post('/', authRequired, adminOnly, (req, res) => {
  const { number, name, price = 0 } = req.body || {};
  if (!number || !name) return res.status(400).json({ error: 'number and name required' });

  try {
    const stmt = db.prepare('INSERT INTO skus (number, name, price, createdAt) VALUES (?,?,?,datetime("now"))');
    const { lastInsertRowid } = stmt.run(number, name, Number(price || 0));
    res.status(201).json({ id: Number(lastInsertRowid), number, name, price: Number(price || 0) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'SKU number already exists' });
    throw e;
  }
});

module.exports = router;
