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

