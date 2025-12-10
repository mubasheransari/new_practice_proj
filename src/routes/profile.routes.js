const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  const u = db
    .prepare(`
      SELECT 
        userCode AS id,          -- 👈 8-char ID
        firstName,
        lastName,
        email,
        role,
        createdAt
      FROM users
      WHERE id = ?
    `)
    .get(req.user.id);

  res.json(u);
});

router.put('/', authRequired, (req, res) => {
  const { firstName, lastName } = req.body || {};
  if (!firstName) return res.status(400).json({ error: 'firstName required' });

  db.prepare('UPDATE users SET firstName = ?, lastName = ? WHERE id = ?')
    .run(firstName, lastName ?? '', req.user.id);

  const updated = db
    .prepare(`
      SELECT 
        userCode AS id,
        firstName,
        lastName,
        email,
        role,
        createdAt
      FROM users
      WHERE id = ?
    `)
    .get(req.user.id);

  res.json(updated);
});

module.exports = router;
