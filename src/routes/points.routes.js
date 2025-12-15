// src/routes/points.routes.js
const express = require('express');
const { db, now } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// ✅ Every user starts with 50 points by default (transferable)
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

function getUserNameByUserCode(userCode) {
  if (!userCode) return null;
  const u = db
    .prepare('SELECT firstName, lastName FROM users WHERE userCode = ?')
    .get(String(userCode).trim());
  if (!u) return null;
  const full = `${u.firstName || ''} ${u.lastName || ''}`.trim();
  return full || null;
}

function mapHistoryRow(row) {
  const base = {
    id: row.id,
    points: row.points,
    createdAt: row.createdAt,
  };

  const reason = (row.reason || '').trim();
  const absPts = Math.abs(Number(row.points || 0));

  // SEND to XXXXXXXX
  if (reason.startsWith('SEND to ')) {
    const code = reason.replace('SEND to ', '').trim();
    const name = getUserNameByUserCode(code) || code;
    return { ...base, send_to: `${absPts} send to ${name}` };
  }

  // RECEIVED from XXXXXXXX
  if (reason.startsWith('RECEIVED from ')) {
    const code = reason.replace('RECEIVED from ', '').trim();
    const name = getUserNameByUserCode(code) || code;
    return { ...base, receive_from: `${absPts} receive from ${name}` };
  }

  // QR redeem / other earning (optional friendly label)
  if (reason.startsWith('QR_REDEEM')) {
    return { ...base, earned_by: 'QR scan' };
  }

  // fallback: omit reason completely (no null fields)
  return base;
}

// ------------------------ SEND POINTS ------------------------
/**
 * POST /api/points/send
 * Body: { points: number, uid: string }
 *
 * - Sender = current logged-in user (from JWT)
 * - uid = receiver's userCode (8-char visible user id)
 * - BASE_POINTS is included in balance
 * - all points are transferable
 */
router.post('/send', authRequired, (req, res) => {
  try {
    const { points, uid } = req.body || {};

    const senderDbId = req.user.id;        // numeric DB id
    const senderCode = req.user.userCode;  // 8-char visible ID

    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: 'points must be a positive integer' });
    }

    if (!uid || typeof uid !== 'string' || !uid.trim()) {
      return res.status(400).json({ error: 'uid (receiver userId) is required' });
    }

    const receiver = db
      .prepare('SELECT id, userCode FROM users WHERE userCode = ?')
      .get(uid.trim());

    if (!receiver) {
      return res.status(404).json({ error: 'receiver not found for given uid' });
    }

    const receiverDbId = receiver.id;
    const receiverCode = receiver.userCode;

    if (receiverDbId === senderDbId) {
      return res.status(400).json({ error: 'cannot send points to yourself' });
    }

    const senderBalanceBefore = getEffectiveBalance(senderDbId);
    if (senderBalanceBefore < points) {
      return res.status(400).json({
        error: 'insufficient points',
        senderBalance: senderBalanceBefore,
      });
    }

    const transferTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(senderDbId, -points, `SEND to ${receiverCode}`, now());

      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(receiverDbId, points, `RECEIVED from ${senderCode}`, now());
    });

    transferTx();

    return res.status(201).json({
      fromUserId: senderCode,
      toUserId: receiverCode,
      points,
      senderBalanceAfter: getEffectiveBalance(senderDbId),
      receiverBalanceAfter: getEffectiveBalance(receiverDbId),
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
 * - history uses send_to / receive_from (no null fields)
 */
router.get('/', authRequired, (req, res) => {
  try {
    const dbUserId = req.user.id;
    const userCode = req.user.userCode;

    const rows = db.prepare(`
      SELECT id, points, reason, createdAt
      FROM user_points
      WHERE userId = ?
      ORDER BY createdAt DESC, id DESC
    `).all(dbUserId);

    return res.json({
      userId: userCode,
      totalPoints: getEffectiveBalance(dbUserId),
      history: rows.map(mapHistoryRow),
    });
  } catch (err) {
    console.error('[points.get] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;

