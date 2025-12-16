// src/routes/qr.routes.js
const express = require('express');
const { db, now, makeQrCodeNumeric, makeQrCodeAlnum } = require('../db');

const router = express.Router();

// ------------------------ helpers ------------------------
function normalizeInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function isPosInt(n) {
  return Number.isInteger(n) && n > 0;
}

function genCode(format, length) {
  if (format === 'numeric') return makeQrCodeNumeric(length);
  return makeQrCodeAlnum(length); // default
}

// ------------------------ ADD / GENERATE ------------------------
/**
 * POST /api/qr/add
 * No auth
 *
 * A) Manual insert:
 * 1) Single:   { "code": "1234567890", "points": 10 }
 * 2) Multiple: { "codes": ["111", "222"], "points": 10 }
 * 3) Items:    { "items": [{ "code":"111","points":10 }, { "code":"222","points":20 }] }
 *
 * B) Generator:
 * { "count": 50, "points": 10, "format": "numeric", "length": 10 }
 * - format: "numeric" | "alnum"
 * - length: default 10 (numeric) / 12 (alnum)
 */
router.post('/add', (req, res) => {
  try {
    const { code, codes, items, points, count, format, length } = req.body || {};

    // -------- Generator mode --------
    if (count !== undefined) {
      const howMany = normalizeInt(count, 0);
      const p = normalizeInt(points, 0);
      const fmt = (String(format || 'numeric').toLowerCase() === 'alnum') ? 'alnum' : 'numeric';

      const defaultLen = fmt === 'numeric' ? 10 : 12;
      const len = normalizeInt(length, defaultLen);

      if (!isPosInt(howMany)) return res.status(400).json({ error: 'count must be a positive integer' });
      if (!isPosInt(p)) return res.status(400).json({ error: 'points must be a positive integer' });
      if (!isPosInt(len) || len < 4 || len > 64) {
        return res.status(400).json({ error: 'length must be between 4 and 64' });
      }
      if (howMany > 5000) {
        return res.status(400).json({ error: 'count too large (max 5000 per request)' });
      }

      const ins = db.prepare(`
        INSERT OR IGNORE INTO qr_codes (code, points, createdAt)
        VALUES (?,?,?)
      `);

      const tx = db.transaction(() => {
        let inserted = 0;
        let skipped = 0;
        const generatedCodes = [];

        // generate until we insert "howMany" unique rows
        // hard cap to avoid infinite loops
        const maxAttempts = howMany * 20;
        let attempts = 0;

        while (inserted < howMany && attempts < maxAttempts) {
          attempts++;
          const c = genCode(fmt, len);

          const info = ins.run(c, p, now());
          if (info.changes === 1) {
            inserted++;
            generatedCodes.push(c);
          } else {
            skipped++; // duplicate (existing)
          }
        }

        if (inserted < howMany) {
          return {
            ok: false,
            error: 'Could not generate enough unique codes, try increasing length',
            requested: howMany,
            inserted,
            skipped,
            attempts,
          };
        }

        return {
          ok: true,
          mode: 'generated',
          requested: howMany,
          inserted,
          skipped,
          format: fmt,
          length: len,
          points: p,
          codes: generatedCodes, // 👈 return generated numbers for QR printing
        };
      });

      const result = tx();
      if (!result.ok) return res.status(409).json(result);
      return res.status(201).json(result);
    }

    // -------- Manual insert mode --------
    const toInsert = [];

    // items mode
    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        const c = String(it?.code || '').trim();
        const p = normalizeInt(it?.points, 0);
        if (!c) continue;
        if (!isPosInt(p)) continue;
        toInsert.push({ code: c, points: p });
      }
    }
    // codes mode
    else if (Array.isArray(codes) && codes.length > 0) {
      const p = normalizeInt(points, 0);
      if (!isPosInt(p)) {
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
      const p = normalizeInt(points, 0);
      if (!c) return res.status(400).json({ error: 'code is required' });
      if (!isPosInt(p)) {
        return res.status(400).json({ error: 'points must be a positive integer' });
      }
      toInsert.push({ code: c, points: p });
    } else {
      return res.status(400).json({
        error: 'Provide either {code, points} OR {codes, points} OR {items:[{code,points}]} OR generator {count, points, format, length}'
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
        else skipped++;
      }
      return { ok: true, mode: 'manual', requested: toInsert.length, inserted, skipped };
    });

    return res.status(201).json(tx());
  } catch (err) {
    console.error('[qr.add] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------ LIST ALL QR CODES ------------------------
/**
 * GET /api/qr
 * No auth
 * Returns latest first
 */
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        id, code, points, createdAt,
        redeemedByUserId, redeemedAt
      FROM qr_codes
      ORDER BY id DESC
    `).all();

    res.json({ count: rows.length, items: rows });
  } catch (err) {
    console.error('[qr.get] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------ SCAN / REDEEM ------------------------
/**
 * POST /api/qr/scan
 * No auth (user provides uid)
 *
 * Body: { "code": "1234567890", "uid": "RKXX6U2M" }
 * - code must exist in qr_codes
 * - must NOT be redeemed already
 * - uid is user's userCode
 * - on success: marks redeemed + adds points to user_points
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

    if (!user) return res.status(404).json({ error: 'user not found for given uid' });

    const scanTx = db.transaction(() => {
      const qr = db
        .prepare('SELECT id, code, points, redeemedByUserId FROM qr_codes WHERE code = ?')
        .get(qrCode);

      if (!qr) return { status: 404, body: { error: 'qr not found' } };
      if (qr.redeemedByUserId) return { status: 409, body: { error: 'qr already scanned' } };

      // mark redeemed (atomic)
      const upd = db.prepare(`
        UPDATE qr_codes
        SET redeemedByUserId = ?, redeemedAt = ?
        WHERE id = ? AND redeemedByUserId IS NULL
      `).run(user.id, now(), qr.id);

      if (upd.changes !== 1) {
        return { status: 409, body: { error: 'qr already scanned' } };
      }

      // add points
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(
        user.id,
        Number(qr.points),
        `QR ${qr.code} redeemed`,
        now()
      );

      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

      return {
        status: 200,
        body: {
          ok: true,
          uid: user.userCode,
          userName: fullName || user.userCode,
          code: qr.code,
          pointsAdded: Number(qr.points),
          message: 'QR scanned successfully'
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




// src/routes/qr.routes.js
// const express = require('express');
// const { db, now } = require('../db');

// const router = express.Router();

// /**
//  * POST /api/qr/add
//  * No auth
//  * want a post and get api of unique random number generator in which user just enter how many number do you want to generate and points of that points and from get api get all the numbers of which user enters through "http://localhost:8080/api/qr/add" and number generator api. 
//  * Supports:
//  * 1) Single code:
//  *    { "code": "1234567890", "points": 10 }
//  *
//  * 2) Multiple codes:
//  *    { "codes": ["111", "222", "333"], "points": 10 }
//  *
//  * 3) Multiple with different points:
//  *    { "items": [{ "code":"111", "points":10 }, { "code":"222", "points":20 }] }
//  */
// router.post('/add', (req, res) => {
//   try {
//     const { code, codes, items, points } = req.body || {};

//     const toInsert = [];

//     // items mode
//     if (Array.isArray(items) && items.length > 0) {
//       for (const it of items) {
//         const c = String(it?.code || '').trim();
//         const p = Number(it?.points);
//         if (!c) continue;
//         if (!Number.isInteger(p) || p <= 0) continue;
//         toInsert.push({ code: c, points: p });
//       }
//     }
//     // codes mode
//     else if (Array.isArray(codes) && codes.length > 0) {
//       const p = Number(points);
//       if (!Number.isInteger(p) || p <= 0) {
//         return res.status(400).json({ error: 'points must be a positive integer' });
//       }
//       for (const c0 of codes) {
//         const c = String(c0 || '').trim();
//         if (!c) continue;
//         toInsert.push({ code: c, points: p });
//       }
//     }
//     // single mode
//     else if (code) {
//       const c = String(code).trim();
//       const p = Number(points);
//       if (!c) return res.status(400).json({ error: 'code is required' });
//       if (!Number.isInteger(p) || p <= 0) {
//         return res.status(400).json({ error: 'points must be a positive integer' });
//       }
//       toInsert.push({ code: c, points: p });
//     } else {
//       return res.status(400).json({
//         error: 'Provide either {code, points} OR {codes, points} OR {items:[{code,points}]}'
//       });
//     }

//     if (toInsert.length === 0) {
//       return res.status(400).json({ error: 'No valid codes to insert' });
//     }

//     const ins = db.prepare(`
//       INSERT OR IGNORE INTO qr_codes (code, points, createdAt)
//       VALUES (?,?,?)
//     `);

//     const tx = db.transaction(() => {
//       let inserted = 0;
//       let skipped = 0;

//       for (const row of toInsert) {
//         const info = ins.run(row.code, row.points, now());
//         if (info.changes === 1) inserted++;
//         else skipped++; // already existed
//       }

//       return { inserted, skipped, requested: toInsert.length };
//     });

//     const result = tx();

//     return res.status(201).json({
//       ok: true,
//       ...result
//     });
//   } catch (err) {
//     console.error('[qr.add] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// /**
//  * POST /api/qr/scan
//  * No auth (user provides uid)
//  *
//  * Body: { "code": "1234567890", "uid": "RKXX6U2M" }
//  * - code must exist in qr_codes
//  * - must NOT be redeemed already
//  * - uid is user's userCode (8-char visible id)
//  * - on success: locks QR + adds points in user_points
//  */
// router.post('/scan', (req, res) => {
//   try {
//     const { code, uid } = req.body || {};
//     const qrCode = String(code || '').trim();
//     const userCode = String(uid || '').trim();

//     if (!qrCode) return res.status(400).json({ error: 'code is required' });
//     if (!userCode) return res.status(400).json({ error: 'uid is required' });

//     // find user by userCode
//     const user = db
//       .prepare('SELECT id, userCode, firstName, lastName FROM users WHERE userCode = ?')
//       .get(userCode);

//     if (!user) {
//       return res.status(404).json({ error: 'user not found for given uid' });
//     }

//     // transaction to prevent double-scan race condition
//     const scanTx = db.transaction(() => {
//       // get QR row
//       const qr = db
//         .prepare('SELECT id, code, points, redeemedByUserId, redeemedAt FROM qr_codes WHERE code = ?')
//         .get(qrCode);

//       if (!qr) {
//         return { status: 404, body: { error: 'qr not found' } };
//       }

//       if (qr.redeemedByUserId) {
//         return { status: 409, body: { error: 'qr already scanned' } };
//       }

//       // mark redeemed
//       db.prepare(`
//         UPDATE qr_codes
//         SET redeemedByUserId = ?, redeemedAt = ?
//         WHERE id = ? AND redeemedByUserId IS NULL
//       `).run(user.id, now(), qr.id);

//       // safety: ensure it actually updated (avoids parallel double scans)
//       const updated = db
//         .prepare('SELECT redeemedByUserId FROM qr_codes WHERE id = ?')
//         .get(qr.id);

//       if (!updated?.redeemedByUserId) {
//         return { status: 409, body: { error: 'qr already scanned' } };
//       }

//       // give points
//       db.prepare(`
//         INSERT INTO user_points (userId, points, reason, createdAt)
//         VALUES (?,?,?,?)
//       `).run(
//         user.id,
//         Number(qr.points),
//         `QR ${qr.code} redeemed`,
//         now()
//       );

//       // calculate total (NOTE: if you use BASE_POINTS=50 in points.routes.js,
//       // keep that logic there; here we return DB total only)
//       const totalRow = db
//         .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
//         .get(user.id);

//       const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

//       return {
//         status: 200,
//         body: {
//           ok: true,
//           uid: user.userCode,
//           userName: fullName || user.userCode,
//           code: qr.code,
//           pointsAdded: Number(qr.points),
//           totalPointsDb: Number(totalRow.totalPoints || 0)
//         }
//       };
//     });

//     const result = scanTx();
//     return res.status(result.status).json(result.body);
//   } catch (err) {
//     console.error('[qr.scan] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// module.exports = router;

