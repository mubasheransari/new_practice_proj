// src/routes/qr.routes.js
const express = require('express');
const { db, now, makeQrCodeNumeric } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// by default every user starts with 50 points (virtual base)
const BASE_POINTS = 50;

/**
 * POST /api/qr/create
 * Create random QR codes and store in DB.
 * Body (optional):
 *  {
 *    "count": 10,
 *    "points": 5,
 *    "length": 10
 *  }
 *
 * Returns created codes list (you will generate QR image from these codes externally)
 */
router.post('/create', (req, res) => {
  try {
    const { count = 10, points = 5, length = 10 } = req.body || {};

    if (!Number.isInteger(count) || count <= 0 || count > 1000) {
      return res.status(400).json({ error: 'count must be an integer 1..1000' });
    }
    if (!Number.isInteger(points) || points <= 0 || points > 100000) {
      return res.status(400).json({ error: 'points must be a positive integer' });
    }
    if (!Number.isInteger(length) || length < 6 || length > 30) {
      return res.status(400).json({ error: 'length must be 6..30' });
    }

    const insert = db.prepare(`
      INSERT INTO qr_codes (code, points, createdAt)
      VALUES (?,?,?)
    `);

    const created = [];

    const tx = db.transaction(() => {
      for (let i = 0; i < count; i++) {
        // generate unique code
        let code = makeQrCodeNumeric(length);
        while (db.prepare('SELECT 1 FROM qr_codes WHERE code = ?').get(code)) {
          code = makeQrCodeNumeric(length);
        }

        insert.run(code, points, now());
        created.push(code);
      }
    });

    tx();

    return res.status(201).json({
      count: created.length,
      pointsPerCode: points,
      codes: created,
    });
  } catch (err) {
    console.error('[qr.create] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

/**
 * POST /api/qr/redeem
 * Body: { code: string }
 *
 * - Requires auth token
 * - If valid & not redeemed: mark redeemed and add points to user_points
 */
router.post('/redeem', authRequired, (req, res) => {
  try {
    const { code } = req.body || {};
    const dbUserId = req.user.id;
    const userCode = req.user.userCode;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code is required' });
    }

    const cleanCode = code.trim();

    // find qr row
    const qr = db
      .prepare(`SELECT id, code, points, redeemedByUserId, redeemedAt
                FROM qr_codes
                WHERE code = ?`)
      .get(cleanCode);

    if (!qr) {
      return res.status(404).json({ error: 'invalid qr code' });
    }

    if (qr.redeemedAt || qr.redeemedByUserId) {
      return res.status(409).json({
        error: 'qr already redeemed',
        redeemedAt: qr.redeemedAt,
      });
    }

    const redeemTx = db.transaction(() => {
      // 1) mark QR redeemed (one-time)
      db.prepare(`
        UPDATE qr_codes
        SET redeemedByUserId = ?, redeemedAt = ?
        WHERE id = ? AND redeemedAt IS NULL AND redeemedByUserId IS NULL
      `).run(dbUserId, now(), qr.id);

      // verify it actually updated (protect against race)
      const updated = db.prepare(`
        SELECT redeemedByUserId, redeemedAt FROM qr_codes WHERE id = ?
      `).get(qr.id);

      if (!updated.redeemedAt || updated.redeemedByUserId !== dbUserId) {
        throw new Error('redeem race detected');
      }

      // 2) add points record
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(dbUserId, qr.points, `QR REDEEM ${qr.code}`, now());
    });

    redeemTx();

    // current balance (base 50 + history)
    const row = db
      .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
      .get(dbUserId);

    const effectiveTotal = BASE_POINTS + (row.totalPoints || 0);

    return res.status(200).json({
      userId: userCode,
      redeemedCode: cleanCode,
      pointsEarned: qr.points,
      totalPoints: effectiveTotal,
      message: 'QR redeemed successfully',
    });
  } catch (err) {
    console.error('[qr.redeem] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
