// // src/routes/qr.routes.js


// src/routes/qr.routes.js
const express = require('express');
const { db, now } = require('../db');

const router = express.Router();

/**
 * POST /api/qr/add
 * No auth
 *
 * Supports:
 * 1) Single code:
 *    { "code": "1234567890", "points": 10 }
 *
 * 2) Multiple codes:
 *    { "codes": ["111", "222", "333"], "points": 10 }
 *
 * 3) Multiple with different points:
 *    { "items": [{ "code":"111", "points":10 }, { "code":"222", "points":20 }] }
 */
router.post('/add', (req, res) => {
  try {
    const { code, codes, items, points } = req.body || {};

    const toInsert = [];

    // items mode
    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        const c = String(it?.code || '').trim();
        const p = Number(it?.points);
        if (!c) continue;
        if (!Number.isInteger(p) || p <= 0) continue;
        toInsert.push({ code: c, points: p });
      }
    }
    // codes mode
    else if (Array.isArray(codes) && codes.length > 0) {
      const p = Number(points);
      if (!Number.isInteger(p) || p <= 0) {
        return res.status(400).json({ error: 'points must be a positive integer' });
      }
      for (const c0 of codes) {
        const c = String(c0 || '').trim();
        if (!c) continue;
        toInsert.push({ code: c, points: p });
      }
    }
    // single mode
    else if (code) {
      const c = String(code).trim();
      const p = Number(points);
      if (!c) return res.status(400).json({ error: 'code is required' });
      if (!Number.isInteger(p) || p <= 0) {
        return res.status(400).json({ error: 'points must be a positive integer' });
      }
      toInsert.push({ code: c, points: p });
    } else {
      return res.status(400).json({
        error: 'Provide either {code, points} OR {codes, points} OR {items:[{code,points}]}'
      });
    }

    if (toInsert.length === 0) {
      return res.status(400).json({ error: 'No valid codes to insert' });
    }

    const ins = db.prepare(`
      INSERT OR IGNORE INTO qr_codes (code, points, createdAt)
      VALUES (?,?,?)
    `);

    const tx = db.transaction(() => {
      let inserted = 0;
      let skipped = 0;

      for (const row of toInsert) {
        const info = ins.run(row.code, row.points, now());
        if (info.changes === 1) inserted++;
        else skipped++; // already existed
      }

      return { inserted, skipped, requested: toInsert.length };
    });

    const result = tx();

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (err) {
    console.error('[qr.add] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

/**
 * POST /api/qr/scan
 * No auth (user provides uid)
 *
 * Body: { "code": "1234567890", "uid": "RKXX6U2M" }
 * - code must exist in qr_codes
 * - must NOT be redeemed already
 * - uid is user's userCode (8-char visible id)
 * - on success: locks QR + adds points in user_points
 */
router.post('/scan', (req, res) => {
  try {
    const { code, uid } = req.body || {};
    const qrCode = String(code || '').trim();
    const userCode = String(uid || '').trim();

    if (!qrCode) return res.status(400).json({ error: 'code is required' });
    if (!userCode) return res.status(400).json({ error: 'uid is required' });

    // find user by userCode
    const user = db
      .prepare('SELECT id, userCode, firstName, lastName FROM users WHERE userCode = ?')
      .get(userCode);

    if (!user) {
      return res.status(404).json({ error: 'user not found for given uid' });
    }

    // transaction to prevent double-scan race condition
    const scanTx = db.transaction(() => {
      // get QR row
      const qr = db
        .prepare('SELECT id, code, points, redeemedByUserId, redeemedAt FROM qr_codes WHERE code = ?')
        .get(qrCode);

      if (!qr) {
        return { status: 404, body: { error: 'qr not found' } };
      }

      if (qr.redeemedByUserId) {
        return { status: 409, body: { error: 'qr already scanned' } };
      }

      // mark redeemed
      db.prepare(`
        UPDATE qr_codes
        SET redeemedByUserId = ?, redeemedAt = ?
        WHERE id = ? AND redeemedByUserId IS NULL
      `).run(user.id, now(), qr.id);

      // safety: ensure it actually updated (avoids parallel double scans)
      const updated = db
        .prepare('SELECT redeemedByUserId FROM qr_codes WHERE id = ?')
        .get(qr.id);

      if (!updated?.redeemedByUserId) {
        return { status: 409, body: { error: 'qr already scanned' } };
      }

      // give points
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(
        user.id,
        Number(qr.points),
        `QR ${qr.code} redeemed`,
        now()
      );

      // calculate total (NOTE: if you use BASE_POINTS=50 in points.routes.js,
      // keep that logic there; here we return DB total only)
      const totalRow = db
        .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
        .get(user.id);

      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

      return {
        status: 200,
        body: {
          ok: true,
          uid: user.userCode,
          userName: fullName || user.userCode,
          code: qr.code,
          pointsAdded: Number(qr.points),
          totalPointsDb: Number(totalRow.totalPoints || 0)
        }
      };
    });

    const result = scanTx();
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[qr.scan] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;


// const express = require('express');
// const { db, now } = require('../db');

// const router = express.Router();

// /**
//  * POST /api/qr/add
//  * Body:
//  * {
//  *   "codes": ["ABC123", "XYZ999"],   // OR single string
//  *   "points": 20
//  * }
//  *
//  * ❌ No auth
//  */
// router.post('/add', (req, res) => {
//   try {
//     let { codes, points } = req.body || {};

//     if (!points || !Number.isInteger(points) || points <= 0) {
//       return res.status(400).json({ error: 'points must be positive integer' });
//     }

//     // allow single string OR array
//     if (typeof codes === 'string') {
//       codes = [codes];
//     }

//     if (!Array.isArray(codes) || codes.length === 0) {
//       return res.status(400).json({ error: 'codes required' });
//     }

//     const insert = db.prepare(`
//       INSERT OR IGNORE INTO qr_codes (code, points, createdAt)
//       VALUES (?,?,?)
//     `);

//     const tx = db.transaction(() => {
//       for (const c of codes) {
//         insert.run(c.trim(), points, now());
//       }
//     });

//     tx();

//     return res.status(201).json({
//       success: true,
//       inserted: codes.length,
//       pointsPerQR: points
//     });
//   } catch (err) {
//     console.error('[qr.add]', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// /**
//  * POST /api/qr/scan
//  * Body:
//  * {
//  *   "code": "ABC123",
//  *   "userId": "RKXX6U2M"   // userCode (8-char)
//  * }
//  *
//  * ❌ No auth
//  */
// router.post('/scan', (req, res) => {
//   try {
//     const { code, userId } = req.body || {};

//     if (!code || !userId) {
//       return res.status(400).json({ error: 'code and userId required' });
//     }

//     // find user by userCode
//     const user = db
//       .prepare('SELECT id, userCode FROM users WHERE userCode = ?')
//       .get(userId.trim());

//     if (!user) {
//       return res.status(404).json({ error: 'user not found' });
//     }

//     // find QR
//     const qr = db
//       .prepare('SELECT * FROM qr_codes WHERE code = ?')
//       .get(code.trim());

//     if (!qr) {
//       return res.status(404).json({ error: 'invalid qr code' });
//     }

//     if (qr.scannedBy) {
//       return res.status(400).json({ error: 'qr already scanned' });
//     }

//     // transaction
//     const tx = db.transaction(() => {
//       // mark qr as scanned
//       db.prepare(`
//         UPDATE qr_codes
//         SET scannedBy = ?, scannedAt = ?
//         WHERE id = ?
//       `).run(user.id, now(), qr.id);

//       // give points
//       db.prepare(`
//         INSERT INTO user_points (userId, points, reason, createdAt)
//         VALUES (?,?,?,?)
//       `).run(
//         user.id,
//         qr.points,
//         `QR SCAN ${qr.code}`,
//         now()
//       );
//     });

//     tx();

//     return res.json({
//       success: true,
//       userId: user.userCode,
//       pointsEarned: qr.points,
//       message: 'QR scanned successfully'
//     });
//   } catch (err) {
//     console.error('[qr.scan]', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// module.exports = router;







// const express = require('express');
// const { db, now, makeQrNumber } = require('../db');
// const { authRequired } = require('../middleware/auth');

// const router = express.Router();

// /**
//  * Helper: only admin can generate QR codes
//  */
// function adminRequired(req, res, next) {
//   if (req.user?.role !== 'admin') {
//     return res.status(403).json({ error: 'admin only' });
//   }
//   next();
// }

// /**
//  * POST /api/qr/generate
//  * Admin only
//  * Body: { count: number, points: number }
//  *
//  * Generates random numeric codes and inserts into qr_codes.
//  */
// router.post('/generate', authRequired, adminRequired, (req, res) => {
//   try {
//     const { count = 10, points = 10 } = req.body || {};

//     if (!Number.isInteger(count) || count <= 0 || count > 5000) {
//       return res.status(400).json({ error: 'count must be an integer between 1 and 5000' });
//     }
//     if (!Number.isInteger(points) || points <= 0) {
//       return res.status(400).json({ error: 'points must be a positive integer' });
//     }

//     const insert = db.prepare(`
//       INSERT INTO qr_codes (code, points, createdAt)
//       VALUES (?,?,?)
//     `);

//     const codes = [];
//     const tx = db.transaction(() => {
//       while (codes.length < count) {
//         const code = makeQrNumber(10); // 10-digit numeric code
//         try {
//           insert.run(code, points, now());
//           codes.push(code);
//         } catch (_) {
//           // UNIQUE collision, generate again
//         }
//       }
//     });

//     tx();

//     return res.status(201).json({
//       count: codes.length,
//       pointsEach: points,
//       codes
//     });
//   } catch (err) {
//     console.error('[qr.generate] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// /**
//  * ✅ PUBLIC (NO AUTH)
//  * POST /api/qr/add
//  * Body: { number: string, points: number }
//  *   OR  { numbers: string[], points: number }
//  *
//  * Use this when you already have numbers you want to print as QR on packets.
//  */
// router.post('/add', (req, res) => {
//   try {
//     const { number, numbers, points = 10 } = req.body || {};

//     if (!Number.isInteger(points) || points <= 0) {
//       return res.status(400).json({ error: 'points must be a positive integer' });
//     }

//     // normalize input to array
//     let list = [];
//     if (Array.isArray(numbers)) list = numbers;
//     else if (number != null) list = [number];

//     list = list
//       .map((x) => (x == null ? '' : String(x).trim()))
//       .filter((x) => x.length > 0);

//     if (list.length === 0) {
//       return res.status(400).json({ error: 'number(s) are required' });
//     }

//     if (list.length > 5000) {
//       return res.status(400).json({ error: 'max 5000 numbers per request' });
//     }

//     const insert = db.prepare(`
//       INSERT INTO qr_codes (code, points, createdAt)
//       VALUES (?,?,?)
//     `);

//     const inserted = [];
//     const duplicates = [];

//     const tx = db.transaction(() => {
//       for (const code of list) {
//         try {
//           insert.run(code, points, now());
//           inserted.push(code);
//         } catch (_) {
//           duplicates.push(code);
//         }
//       }
//     });

//     tx();

//     return res.status(201).json({
//       insertedCount: inserted.length,
//       duplicateCount: duplicates.length,
//       pointsEach: points,
//       inserted,
//       duplicates,
//     });
//   } catch (err) {
//     console.error('[qr.add] error:', err); // 👈 check terminal for real error
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// /**
//  * POST /api/qr/redeem  (AUTH REQUIRED)
//  * User scans QR and sends code
//  * Body: { code: string }
//  *
//  * One-time redeem:
//  * - If code not found => 404
//  * - If already redeemed => 409 ("qr already scanned")
//  * - Otherwise: mark redeemed + add points to user_points
//  */
// router.post('/redeem', authRequired, (req, res) => {
//   try {
//     const { code } = req.body || {};
//     const dbUserId = req.user.id;

//     if (!code || typeof code !== 'string') {
//       return res.status(400).json({ error: 'code is required' });
//     }

//     const clean = code.trim();

//     const redeemTx = db.transaction(() => {
//       const qr = db.prepare(`
//         SELECT id, code, points, isRedeemed, redeemedBy, redeemedAt
//         FROM qr_codes
//         WHERE code = ?
//       `).get(clean);

//       if (!qr) {
//         return { status: 404, body: { error: 'invalid QR code' } };
//       }

//       if (qr.isRedeemed === 1) {
//         return { status: 409, body: { error: 'qr already scanned', redeemedAt: qr.redeemedAt } };
//       }

//       // mark redeemed
//       db.prepare(`
//         UPDATE qr_codes
//         SET isRedeemed = 1, redeemedBy = ?, redeemedAt = ?
//         WHERE id = ? AND isRedeemed = 0
//       `).run(dbUserId, now(), qr.id);

//       // add points
//       db.prepare(`
//         INSERT INTO user_points (userId, points, reason, createdAt)
//         VALUES (?,?,?,?)
//       `).run(dbUserId, qr.points, `QR_REDEEM ${qr.code}`, now());

//       return {
//         status: 200,
//         body: { ok: true, redeemedCode: qr.code, pointsAdded: qr.points }
//       };
//     });

//     const result = redeemTx();
//     return res.status(result.status).json(result.body);
//   } catch (err) {
//     console.error('[qr.redeem] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// module.exports = router;
