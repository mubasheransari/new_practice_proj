const express = require('express');
const { db, now } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/attendance/mark  { action: 'IN'|'OUT', lat?, lng? }
router.post('/mark', authRequired, (req, res) => {
  const { action, lat, lng } = req.body || {};
  if (!action || !['IN', 'OUT'].includes(action)) {
    return res.status(400).json({ error: "action must be 'IN' or 'OUT'" });
  }
  const stmt = db.prepare('INSERT INTO attendance (userId, action, lat, lng, createdAt) VALUES (?,?,?,?,?)');
  const { lastInsertRowid } = stmt.run(req.user.id, action, lat ?? null, lng ?? null, now());
  res.status(201).json({ id: Number(lastInsertRowid), action, lat, lng });
});

// GET /api/attendance/history
router.get('/history', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT id, action, lat, lng, createdAt
    FROM attendance WHERE userId = ? ORDER BY id DESC
  `).all(req.user.id);
  res.json(rows);
});

module.exports = router;
