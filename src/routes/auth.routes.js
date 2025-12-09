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
  const userCode = makeUserCode(); // 8-char alphanumeric

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
    VALUES (?,?,?,?,?, 'user', ?,?,?,?)
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
      id: Number(lastInsertRowid), // internal numeric
      code: userCode,             // public 8-char id
      email,
      role: 'user'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.status(201).json({ token });
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
      id: user.id,          // internal numeric id
      code: user.userCode,  // 8-char public id
      email: user.email,
      role: user.role       // 'user' or 'admin'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token });
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  const u = db.prepare(`
    SELECT 
      userCode AS id,  -- 👈 8-char alphanumeric id in response
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

  res.json(u);
});

module.exports = router;


// // src/routes/auth.routes.js
// const express = require('express');
// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');
// const { db, now, makeUserCode } = require('../db');
// const { authRequired } = require('../middleware/auth');

// const router = express.Router();
// const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-change-me';

// // POST /api/auth/signup
// router.post('/signup', (req, res) => {
//   const {
//     firstName,
//     lastName = '',
//     email,
//     password,
//     residentialAddress,
//     phoneNumber,
//     city
//   } = req.body || {};

//   if (!firstName || !email || !password || !residentialAddress || !phoneNumber || !city) {
//     return res.status(400).json({
//       error: 'firstName, email, password, residentialAddress, phoneNumber, city required'
//     });
//   }

//   const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
//   if (existing) {
//     return res.status(409).json({ error: 'email already registered' });
//   }

//   const hash = bcrypt.hashSync(password, 10);
//   const userCode = makeUserCode(); // ✅ 8-char random ID

//   const { lastInsertRowid } = db.prepare(`
//     INSERT INTO users (
//       userCode,
//       firstName,
//       lastName,
//       email,
//       passwordHash,
//       role,
//       residentialAddress,
//       phoneNumber,
//       city,
//       createdAt
//     )
//     VALUES (?,?,?,?, 'user', ?,?,?,?,?)
//   `).run(
//     userCode,
//     firstName,
//     lastName,
//     email,
//     hash,
//     residentialAddress,
//     phoneNumber,
//     city,
//     now()
//   );

//   const token = jwt.sign(
//     { id: Number(lastInsertRowid), userCode, email, role: 'user' },
//     JWT_SECRET,
//     { expiresIn: '7d' }
//   );

//   return res.status(201).json({ token });
// });

// // POST /api/auth/login
// router.post('/login', (req, res) => {
//   const { email, password } = req.body || {};
//   if (!email || !password)
//     return res.status(400).json({ error: 'email & password required' });

//   const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
//   if (!user) return res.status(401).json({ error: 'invalid credentials' });

//   const ok = bcrypt.compareSync(password, user.passwordHash);
//   if (!ok) return res.status(401).json({ error: 'invalid credentials' });

//   const token = jwt.sign(
//     {
//       id: user.id,
//       userCode: user.userCode,
//       email: user.email,
//       role: user.role
//     },
//     JWT_SECRET,
//     { expiresIn: '7d' }
//   );

//   res.json({ token });
// });

// // GET /api/auth/me
// router.get('/me', authRequired, (req, res) => {
//   const u = db.prepare(`
//     SELECT 
//       id,
//       userCode,
//       firstName,
//       lastName,
//       email,
//       role,
//       residentialAddress,
//       phoneNumber,
//       city,
//       createdAt
//     FROM users
//     WHERE id = ?
//   `).get(req.user.id);

//   res.json(u);
// });

// module.exports = router;


// const express = require('express');
// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');
// const { db, now } = require('../db');
// const { authRequired } = require('../middleware/auth');

// const router = express.Router();
// const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-change-me';

// // POST /api/auth/signup
// router.post('/signup', (req, res) => {
//   const {
//     firstName,
//     lastName = '',
//     email,
//     password,
//     residentialAddress,
//     phoneNumber,
//     city
//   } = req.body || {};

//   if (!firstName || !email || !password || !residentialAddress || !phoneNumber || !city) {
//     return res.status(400).json({
//       error: 'firstName, email, password, residentialAddress, phoneNumber, city required'
//     });
//   }

//   const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
//   if (existing) {
//     return res.status(409).json({ error: 'email already registered' });
//   }

//   const hash = bcrypt.hashSync(password, 10);

//   const { lastInsertRowid } = db.prepare(`
//     INSERT INTO users (
//       firstName,
//       lastName,
//       email,
//       passwordHash,
//       role,
//       residentialAddress,
//       phoneNumber,
//       city,
//       createdAt
//     )
//     VALUES (?,?,?,?, 'user', ?,?,?,?)
//   `).run(
//     firstName,
//     lastName,
//     email,
//     hash,
//     residentialAddress,
//     phoneNumber,
//     city,
//     now()
//   );

//   const token = jwt.sign(
//     { id: Number(lastInsertRowid), email, role: 'user' },
//     JWT_SECRET,
//     { expiresIn: '7d' }
//   );

//   return res.status(201).json({ token });
// });

// // POST /api/auth/login
// router.post('/login', (req, res) => {
//   const { email, password } = req.body || {};
//   if (!email || !password)
//     return res.status(400).json({ error: 'email & password required' });

//   const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
//   if (!user) return res.status(401).json({ error: 'invalid credentials' });

//   const ok = bcrypt.compareSync(password, user.passwordHash);
//   if (!ok) return res.status(401).json({ error: 'invalid credentials' });

//   const token = jwt.sign(
//     { id: user.id, email: user.email, role: user.role },
//     JWT_SECRET,
//     { expiresIn: '7d' }
//   );

//   res.json({ token });
// });

// // GET /api/auth/me
// router.get('/me', authRequired, (req, res) => {
//   const u = db.prepare(`
//     SELECT 
//       id, firstName, lastName, email, role,
//       residentialAddress, phoneNumber, city,
//       createdAt
//     FROM users
//     WHERE id=?
//   `).get(req.user.id);

//   res.json(u);
// });

// module.exports = router;


