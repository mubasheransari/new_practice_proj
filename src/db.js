// src/db.js
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(process.cwd(), 'data.sqlite');
const db = new Database(DB_PATH, { fileMustExist: false });

const now = () => new Date().toISOString();

// 👉 generate unique 8-char ID like "A9XK2P3Q"
function makeUserCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  while (true) {
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    const exists = db.prepare('SELECT id FROM users WHERE userCode = ?').get(code);
    if (!exists) return code;
  }
}

function ensureDb() {
  // --- tables ---
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      userCode            TEXT NOT NULL UNIQUE,          -- 8-char visible ID
      firstName           TEXT NOT NULL,
      lastName            TEXT DEFAULT '',
      email               TEXT NOT NULL UNIQUE,
      passwordHash        TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'user',
      residentialAddress  TEXT,
      phoneNumber         TEXT,
      city                TEXT,
      createdAt           TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skus (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      number    TEXT NOT NULL UNIQUE,
      name      TEXT NOT NULL,
      price     REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      skuId     INTEGER NOT NULL,
      quantity  INTEGER NOT NULL,
      total     REAL NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (skuId)  REFERENCES skus(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      action    TEXT NOT NULL,  -- 'IN' | 'OUT'
      lat       REAL,
      lng       REAL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    -- user-specific points history
    CREATE TABLE IF NOT EXISTS user_points (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,      -- FK to users.id (numeric)
      points    INTEGER NOT NULL,      -- +earn / -redeem / -send / +receive
      reason    TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);

  // --- seed admin from ENV ---
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!admin) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    const userCode = makeUserCode();
    db.prepare(`
      INSERT INTO users (
        userCode,
        firstName,
        lastName,
        email,
        passwordHash,
        role,
        createdAt
      )
      VALUES (?,?,?,?,?,'admin',?)
    `).run(
      userCode,
      'Admin',
      'User',
      adminEmail,
      hash,
      now()
    );
    console.log(`[db] Seeded admin: ${adminEmail} / ${adminPassword}`);
  }

  // --- seed SKUs once ---
  const skuCount = db.prepare('SELECT COUNT(*) AS c FROM skus').get().c;
  if (skuCount === 0) {
    const ins = db.prepare('INSERT INTO skus (number, name, price, createdAt) VALUES (?,?,?,?)');
    ins.run('SKU-100', 'Blue Tea Pack', 200, now());
    ins.run('SKU-200', 'Green Tea Pack', 180, now());
    ins.run('SKU-300', 'Black Tea Pack', 220, now());
    console.log('[db] Seeded sample SKUs');
  }
}

module.exports = { db, now, ensureDb, makeUserCode };





























































// const Database = require('better-sqlite3');
// const path = require('path');
// const bcrypt = require('bcryptjs');

// const DB_PATH = path.join(process.cwd(), 'data.sqlite');
// const db = new Database(DB_PATH, { fileMustExist: false });

// const now = () => new Date().toISOString();

// // ---------- userCode helpers (8-char alphanumeric) ----------
// function randomUserCode(length = 8) {
//   const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
//   let out = '';
//   for (let i = 0; i < length; i++) {
//     out += chars[Math.floor(Math.random() * chars.length)];
//   }
//   return out;
// }

// function makeUserCode() {
//   // loop until we find a unique code
//   // (small db, so this is fine)
//   while (true) {
//     const code = randomUserCode(8);
//     const existing = db
//       .prepare('SELECT 1 FROM users WHERE userCode = ?')
//       .get(code);
//     if (!existing) return code;
//   }
// }

// function ensureDb() {
//   // --- tables ---
//   db.exec(`
//     PRAGMA foreign_keys = ON;

//     -- USERS
//     CREATE TABLE IF NOT EXISTS users (
//       id                 INTEGER PRIMARY KEY AUTOINCREMENT,
//       userCode           TEXT NOT NULL UNIQUE,        -- 👈 8-char visible ID
//       firstName          TEXT NOT NULL,
//       lastName           TEXT DEFAULT '',
//       email              TEXT NOT NULL UNIQUE,
//       passwordHash       TEXT NOT NULL,
//       role               TEXT NOT NULL DEFAULT 'user',
//       residentialAddress TEXT,
//       phoneNumber        TEXT,
//       city               TEXT,
//       createdAt          TEXT NOT NULL
//     );

//     -- SKUs
//     CREATE TABLE IF NOT EXISTS skus (
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
//       number    TEXT NOT NULL UNIQUE,
//       name      TEXT NOT NULL,
//       price     REAL NOT NULL DEFAULT 0,
//       createdAt TEXT NOT NULL
//     );

//     -- SALES
//     CREATE TABLE IF NOT EXISTS sales (
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
//       userId    INTEGER NOT NULL,
//       skuId     INTEGER NOT NULL,
//       quantity  INTEGER NOT NULL,
//       total     REAL NOT NULL,
//       createdAt TEXT NOT NULL,
//       FOREIGN KEY (userId) REFERENCES users(id),
//       FOREIGN KEY (skuId)  REFERENCES skus(id)
//     );

//     -- ATTENDANCE
//     CREATE TABLE IF NOT EXISTS attendance (
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
//       userId    INTEGER NOT NULL,
//       action    TEXT NOT NULL,  -- 'IN' | 'OUT'
//       lat       REAL,
//       lng       REAL,
//       createdAt TEXT NOT NULL,
//       FOREIGN KEY (userId) REFERENCES users(id)
//     );

//     -- USER POINTS
//     CREATE TABLE IF NOT EXISTS user_points (
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
//       userId    INTEGER NOT NULL,
//       points    INTEGER NOT NULL,   -- +earn / -redeem
//       reason    TEXT,
//       createdAt TEXT NOT NULL,
//       FOREIGN KEY (userId) REFERENCES users(id)
//     );
//   `);

//   // --- seed admin from ENV ---
//   const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
//   const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

//   const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
//   if (!admin) {
//     const hash = bcrypt.hashSync(adminPassword, 10);
//     const adminCode = makeUserCode();

//     db.prepare(`
//       INSERT INTO users (
//         userCode,
//         firstName,
//         lastName,
//         email,
//         passwordHash,
//         role,
//         createdAt
//       )
//       VALUES (?, 'Admin', 'User', ?, ?, 'admin', ?)
//     `).run(adminCode, adminEmail, hash, now());

//     console.log(
//       `[db] Seeded admin: ${adminEmail} / ${adminPassword} / code=${adminCode}`
//     );
//   }

//   // --- seed SKUs once ---
//   const skuCount = db.prepare('SELECT COUNT(*) AS c FROM skus').get().c;
//   if (skuCount === 0) {
//     const ins = db.prepare(
//       'INSERT INTO skus (number, name, price, createdAt) VALUES (?,?,?,?)'
//     );
//     ins.run('SKU-100', 'Blue Tea Pack', 200, now());
//     ins.run('SKU-200', 'Green Tea Pack', 180, now());
//     ins.run('SKU-300', 'Black Tea Pack', 220, now());
//     console.log('[db] Seeded sample SKUs');
//   }
// }

// module.exports = { db, now, ensureDb, makeUserCode };




























































// const Database = require('better-sqlite3');
// const path = require('path');
// const bcrypt = require('bcryptjs');

// const DB_PATH = path.join(process.cwd(), 'data.sqlite');
// const db = new Database(DB_PATH, { fileMustExist: false });

// const now = () => new Date().toISOString();

// // generate random 8-char alphanumeric code
// function generateUserCode() {
//   const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
//   let code = '';
//   for (let i = 0; i < 8; i++) {
//     code += chars[Math.floor(Math.random() * chars.length)];
//   }
//   return code;
// }

// // ensure uniqueness in DB
// function makeUserCode() {
//   while (true) {
//     const code = generateUserCode();
//     const existing = db.prepare('SELECT 1 FROM users WHERE userCode = ?').get(code);
//     if (!existing) return code;
//   }
// }

// function ensureDb() {
//   // --- tables ---
//   db.exec(`
//     PRAGMA foreign_keys = ON;

//     CREATE TABLE IF NOT EXISTS users (
//       id                  INTEGER PRIMARY KEY AUTOINCREMENT,
//       userCode            TEXT NOT NULL UNIQUE,   -- 8-char public ID
//       firstName           TEXT NOT NULL,
//       lastName            TEXT DEFAULT '',
//       email               TEXT NOT NULL UNIQUE,
//       passwordHash        TEXT NOT NULL,
//       role                TEXT NOT NULL DEFAULT 'user',
//       residentialAddress  TEXT,
//       phoneNumber         TEXT,
//       city                TEXT,
//       createdAt           TEXT NOT NULL
//     );

//     CREATE TABLE IF NOT EXISTS skus (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       number    TEXT NOT NULL UNIQUE,
//       name      TEXT NOT NULL,
//       price     REAL NOT NULL DEFAULT 0,
//       createdAt TEXT NOT NULL
//     );

//     CREATE TABLE IF NOT EXISTS sales (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       userId    INTEGER NOT NULL,
//       skuId     INTEGER NOT NULL,
//       quantity  INTEGER NOT NULL,
//       total     REAL NOT NULL,
//       createdAt TEXT NOT NULL,
//       FOREIGN KEY (userId) REFERENCES users(id),
//       FOREIGN KEY (skuId)  REFERENCES skus(id)
//     );

//     CREATE TABLE IF NOT EXISTS attendance (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       userId    INTEGER NOT NULL,
//       action    TEXT NOT NULL,  -- 'IN' | 'OUT'
//       lat       REAL,
//       lng       REAL,
//       createdAt TEXT NOT NULL,
//       FOREIGN KEY (userId) REFERENCES users(id)
//     );

//     -- user-specific points history
//     CREATE TABLE IF NOT EXISTS user_points (
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
//       userId    INTEGER NOT NULL,
//       points    INTEGER NOT NULL,   -- +earn / -redeem
//       reason    TEXT,
//       createdAt TEXT NOT NULL,
//       FOREIGN KEY (userId) REFERENCES users(id)
//     );
//   `);

//   // --- seed admin from ENV ---
//   const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
//   const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

//   const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
//   if (!admin) {
//     const hash = bcrypt.hashSync(adminPassword, 10);
//     const adminCode = makeUserCode();
//     db.prepare(`
//       INSERT INTO users (
//         userCode,
//         firstName,
//         lastName,
//         email,
//         passwordHash,
//         role,
//         createdAt
//       )
//       VALUES (?, 'Admin', 'User', ?, ?, 'admin', ?)
//     `).run(adminCode, adminEmail, hash, now());
//     console.log(`[db] Seeded admin: ${adminEmail} / ${adminPassword}`);
//   }

//   // --- seed SKUs once ---
//   const skuCount = db.prepare('SELECT COUNT(*) AS c FROM skus').get().c;
//   if (skuCount === 0) {
//     const ins = db.prepare('INSERT INTO skus (number, name, price, createdAt) VALUES (?,?,?,?)');
//     ins.run('SKU-100', 'Blue Tea Pack', 200, now());
//     ins.run('SKU-200', 'Green Tea Pack', 180, now());
//     ins.run('SKU-300', 'Black Tea Pack', 220, now());
//     console.log('[db] Seeded sample SKUs');
//   }
// }

// module.exports = { db, now, ensureDb, makeUserCode };

