const express = require('express');
const { db, now } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /api/points  (add or subtract points)
router.post('/', authRequired, (req, res) => {
  const { points, reason = null } = req.body || {};
  const userId = req.user.id;

  if (!Number.isInteger(points)) {
    return res.status(400).json({ error: 'points must be an integer' });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO user_points (userId, points, reason, createdAt)
    VALUES (?,?,?,?)
  `).run(userId, points, reason, now());

  const totalRow = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
    .get(userId);

  return res.status(201).json({
    id: Number(lastInsertRowid),
    userId,
    points,
    reason,
    totalPoints: totalRow.totalPoints
  });
});

// GET /api/points  (get total + history)
router.get('/', authRequired, (req, res) => {
  const userId = req.user.id;

  const totalRow = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
    .get(userId);

  const history = db.prepare(`
    SELECT id, points, reason, createdAt
    FROM user_points
    WHERE userId = ?
    ORDER BY createdAt DESC, id DESC
  `).all(userId);

  res.json({
    userId,
    totalPoints: totalRow.totalPoints,
    history
  });
});

module.exports = router;
