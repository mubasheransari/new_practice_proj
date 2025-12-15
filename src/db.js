// src/db.js
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = path.join(process.cwd(), 'data.sqlite');
const db = new Database(DB_PATH, { fileMustExist: false });

const now = () => new Date().toISOString();

// 8 chars alphanumeric (A-Z, 0-9)
function makeUserCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// generate QR code values (numbers only) OR alphanumeric (you choose)
function makeQrCodeNumeric(length = 10) {
  const digits = '0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += digits[Math.floor(Math.random() * digits.length)];
  return out;
}

// safer random (optional)
function makeQrCodeAlnum(length = 12) {
  // base64url without symbols, then slice
  return crypto.randomBytes(16).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, length);
}

function ensureDb() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userCode            TEXT NOT NULL UNIQUE,         -- 👈 8-char visible user ID
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number    TEXT NOT NULL UNIQUE,
      name      TEXT NOT NULL,
      price     REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      skuId     INTEGER NOT NULL,
      quantity  INTEGER NOT NULL,
      total     REAL NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (skuId)  REFERENCES skus(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      action    TEXT NOT NULL,
      lat       REAL,
      lng       REAL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_points (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      points    INTEGER NOT NULL,
      reason    TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    -- ✅ QR codes table (one-time redeem)
    CREATE TABLE IF NOT EXISTS qr_codes (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      code               TEXT NOT NULL UNIQUE,          -- the number printed in QR
      points             INTEGER NOT NULL DEFAULT 0,    -- how many points this QR gives
      createdAt          TEXT NOT NULL,
      redeemedByUserId   INTEGER,                       -- who redeemed it
      redeemedAt         TEXT,
      FOREIGN KEY (redeemedByUserId) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_qr_codes_code ON qr_codes(code);
    CREATE INDEX IF NOT EXISTS idx_qr_codes_redeemedBy ON qr_codes(redeemedByUserId);
  `);

  // --- seed admin from ENV ---
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!admin) {
    const hash = bcrypt.hashSync(adminPassword, 10);

    // generate unique userCode
    let userCode = makeUserCode();
    while (db.prepare('SELECT 1 FROM users WHERE userCode=?').get(userCode)) {
      userCode = makeUserCode();
    }

    db.prepare(`
      INSERT INTO users (userCode, firstName, lastName, email, passwordHash, role, createdAt)
      VALUES (?, 'Admin','User', ?, ?, 'admin', ?)
    `).run(userCode, adminEmail, hash, now());

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

module.exports = {
  db,
  now,
  ensureDb,
  makeUserCode,
  makeQrCodeNumeric,
  makeQrCodeAlnum,
};






// // src/db.js
// const Database = require('better-sqlite3');
// const path = require('path');
// const bcrypt = require('bcryptjs');

// const DB_PATH = path.join(process.cwd(), 'data.sqlite');
// const db = new Database(DB_PATH, { fileMustExist: false });

// const now = () => new Date().toISOString();

// // 👉 generate unique 8-char ID like "A9XK2P3Q"
// function makeUserCode() {
//   const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
//   while (true) {
//     let code = '';
//     for (let i = 0; i < 8; i++) {
//       code += chars[Math.floor(Math.random() * chars.length)];
//     }
//     const exists = db.prepare('SELECT id FROM users WHERE userCode = ?').get(code);
//     if (!exists) return code;
//   }
// }

// function ensureDb() {
//   // --- tables ---
//   db.exec(`
//     PRAGMA foreign_keys = ON;

//     CREATE TABLE IF NOT EXISTS users (
//       id                  INTEGER PRIMARY KEY AUTOINCREMENT,
//       userCode            TEXT NOT NULL UNIQUE,          -- 8-char visible ID
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
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
//       number    TEXT NOT NULL UNIQUE,
//       name      TEXT NOT NULL,
//       price     REAL NOT NULL DEFAULT 0,
//       createdAt TEXT NOT NULL
//     );

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

//     CREATE TABLE IF NOT EXISTS attendance (
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
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
//       userId    INTEGER NOT NULL,      -- FK to users.id (numeric)
//       points    INTEGER NOT NULL,      -- +earn / -redeem / -send / +receive
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
//     const userCode = makeUserCode();
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
//       VALUES (?,?,?,?,?,'admin',?)
//     `).run(
//       userCode,
//       'Admin',
//       'User',
//       adminEmail,
//       hash,
//       now()
//     );
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


















































