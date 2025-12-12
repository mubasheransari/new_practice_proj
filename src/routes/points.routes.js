// src/routes/points.routes.js
const express = require('express');
const { db, now } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// ✅ Every user starts with 50 points by default
const BASE_POINTS = 50;

// ------------------------ helpers ------------------------
function getDbPointsTotal(dbUserId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
    .get(dbUserId);

  return Number(row?.totalPoints || 0);
}

function getEffectiveBalance(dbUserId) {
  return BASE_POINTS + getDbPointsTotal(dbUserId);
}

// ------------------------ SEND POINTS ------------------------
/**
 * POST /api/points/send
 * Body: { points: number, uid: string }
 *
 * - Sender = current logged-in user (from JWT)
 * - uid = receiver's userCode (8-char visible user id)
 * - default BASE_POINTS is included in balances
 * - all points are transferable
 */
router.post('/send', authRequired, (req, res) => {
  try {
    const { points, uid } = req.body || {};

    const senderDbId = req.user.id;        // numeric DB id
    const senderCode = req.user.userCode;  // 8-char visible ID

    // --- validation ---
    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: 'points must be a positive integer' });
    }

    if (!uid || typeof uid !== 'string' || !uid.trim()) {
      return res.status(400).json({ error: 'uid (receiver userId) is required' });
    }

    // --- find receiver by userCode ---
    const receiver = db
      .prepare('SELECT id, userCode FROM users WHERE userCode = ?')
      .get(uid.trim());

    if (!receiver) {
      return res.status(404).json({ error: 'receiver not found for given uid' });
    }

    const receiverDbId = receiver.id;
    const receiverCode = receiver.userCode;

    // cannot send to self
    if (receiverDbId === senderDbId) {
      return res.status(400).json({ error: 'cannot send points to yourself' });
    }

    // --- check sender balance (includes default 50) ---
    const senderBalanceBefore = getEffectiveBalance(senderDbId);

    if (senderBalanceBefore < points) {
      return res.status(400).json({
        error: 'insufficient points',
        senderBalance: senderBalanceBefore
      });
    }

    // --- transaction: move points from sender -> receiver ---
    const transferTx = db.transaction(() => {
      // sender: negative points
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(
        senderDbId,
        -points,
        `SEND to ${receiverCode}`,
        now()
      );

      // receiver: positive points
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(
        receiverDbId,
        points,
        `RECEIVED from ${senderCode}`,
        now()
      );
    });

    transferTx();

    // --- balances after transfer (includes default 50) ---
    const senderBalanceAfter = getEffectiveBalance(senderDbId);
    const receiverBalanceAfter = getEffectiveBalance(receiverDbId);

    return res.status(201).json({
      fromUserId: senderCode,        // sender visible 8-char id
      toUserId: receiverCode,        // receiver visible 8-char id
      points,
      senderBalanceAfter,
      receiverBalanceAfter
    });
  } catch (err) {
    console.error('[points.send] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------ GET POINTS ------------------------
/**
 * GET /api/points
 * - returns current user's own total + history
 * - totalPoints includes default 50
 */
router.get('/', authRequired, (req, res) => {
  try {
    const dbUserId = req.user.id;
    const userCode = req.user.userCode;

    const dbTotal = getDbPointsTotal(dbUserId);
    const totalPoints = BASE_POINTS + dbTotal;

    const history = db.prepare(`
      SELECT id, points, reason, createdAt
      FROM user_points
      WHERE userId = ?
      ORDER BY createdAt DESC, id DESC
    `).all(dbUserId);

    return res.json({
      userId: userCode,     // 8-char visible id
      totalPoints,          // includes default 50
      history
    });
  } catch (err) {
    console.error('[points.get] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
