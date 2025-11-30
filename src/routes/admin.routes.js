const express = require('express');
const { db } = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/users
router.get('/users', authRequired, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT id, firstName, lastName, email, role, createdAt FROM users ORDER BY id DESC').all();
  res.json(rows);
});

// GET /api/admin/sales
router.get('/sales', authRequired, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, u.email as userEmail, sk.number as skuNumber, sk.name as skuName,
           s.quantity, s.total, s.createdAt
    FROM sales s
    JOIN users u ON u.id = s.userId
    JOIN skus sk ON sk.id = s.skuId
    ORDER BY s.id DESC
  `).all();
  res.json(rows);
});

// GET /api/admin/attendance
router.get('/attendance', authRequired, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, u.email as userEmail, a.action, a.lat, a.lng, a.createdAt
    FROM attendance a
    JOIN users u ON u.id = a.userId
    ORDER BY a.id DESC
  `).all();
  res.json(rows);
});

module.exports = router;
