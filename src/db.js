const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(process.cwd(), 'data.sqlite');
const db = new Database(DB_PATH, { fileMustExist: false });

const now = () => new Date().toISOString();

function ensureDb() {
  // --- tables ---
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      action    TEXT NOT NULL,  -- 'IN' | 'OUT'
      lat       REAL,
      lng       REAL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    -- ✅ user-specific points history
    CREATE TABLE IF NOT EXISTS user_points (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      points    INTEGER NOT NULL,   -- +earn / -redeem
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
    db.prepare(`
      INSERT INTO users (firstName, lastName, email, passwordHash, role, createdAt)
      VALUES ('Admin','User', ?, ?, 'admin', ?)
    `).run(adminEmail, hash, now());
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

module.exports = { db, now, ensureDb };



// const Database = require('better-sqlite3');
// const path = require('path');
// const bcrypt = require('bcryptjs');

// const DB_PATH = path.join(process.cwd(), 'data.sqlite');
// const db = new Database(DB_PATH, { fileMustExist: false });

// const now = () => new Date().toISOString();

// function ensureDb() {
//   // --- tables ---
//   db.exec(`
//     PRAGMA foreign_keys = ON;

//     CREATE TABLE IF NOT EXISTS users (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       firstName   TEXT NOT NULL,
//       lastName    TEXT DEFAULT '',
//       email       TEXT NOT NULL UNIQUE,
//       passwordHash TEXT NOT NULL,
//       role        TEXT NOT NULL DEFAULT 'user',
//       createdAt   TEXT NOT NULL
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
//   `);

//   // --- seed admin from ENV ---
//   const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
//   const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

//   const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
//   if (!admin) {
//     const hash = bcrypt.hashSync(adminPassword, 10);
//     db.prepare(`
//       INSERT INTO users (firstName, lastName, email, passwordHash, role, createdAt)
//       VALUES ('Admin','User', ?, ?, 'admin', ?)
//     `).run(adminEmail, hash, now());
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

// module.exports = { db, now, ensureDb };
