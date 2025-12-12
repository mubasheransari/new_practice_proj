// src/routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, now, makeUserCode } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-change-me';

// POST /api/auth/signup
router.post('/signup', (req, res) => {
  const {
    firstName,
    lastName = '',
    email,
    password,
    residentialAddress,
    phoneNumber,
    city
  } = req.body || {};

  if (!firstName || !email || !password || !residentialAddress || !phoneNumber || !city) {
    return res.status(400).json({
      error: 'firstName, email, password, residentialAddress, phoneNumber, city required'
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'email already registered' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const userCode = makeUserCode();

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO users (
      userCode,
      firstName,
      lastName,
      email,
      passwordHash,
      role,
      residentialAddress,
      phoneNumber,
      city,
      createdAt
    )
    VALUES (?,?,?,?,?,'user',?,?,?,?)
  `).run(
    userCode,
    firstName,
    lastName,
    email,
    hash,
    residentialAddress,
    phoneNumber,
    city,
    now()
  );

  const token = jwt.sign(
    {
      id: Number(lastInsertRowid), // numeric DB id
      userCode,                    // 8-char visible ID
      email,
      role: 'user'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.status(201).json({
    token,
    user: {
      id: userCode,          // visible ID for frontend
      userCode,
      dbId: Number(lastInsertRowid),
      firstName,
      lastName,
      email,
      role: 'user'
    }
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'email & password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const token = jwt.sign(
    {
      id: user.id,
      userCode: user.userCode,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.userCode,
      userCode: user.userCode,
      dbId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role
    }
  });
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  const u = db.prepare(`
    SELECT 
      id,
      userCode,
      firstName,
      lastName,
      email,
      role,
      residentialAddress,
      phoneNumber,
      city,
      createdAt
    FROM users
    WHERE id = ?
  `).get(req.user.id);

  if (!u) return res.status(404).json({ error: 'user not found' });

  res.json({
    id: u.userCode,        // 👈 visible ID
    userCode: u.userCode,
    dbId: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    residentialAddress: u.residentialAddress,
    phoneNumber: u.phoneNumber,
    city: u.city,
    createdAt: u.createdAt
  });
});

module.exports = router;










 