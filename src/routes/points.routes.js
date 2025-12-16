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

function getUserNameByCode(userCode) {
  if (!userCode) return null;

  const u = db
    .prepare('SELECT firstName, lastName FROM users WHERE userCode = ?')
    .get(userCode);

  if (!u) return null;
  const full = `${u.firstName || ''} ${u.lastName || ''}`.trim();
  return full || null;
}

// supports both:
// - new: "SEND_TO:ABC12345" / "RECEIVE_FROM:ABC12345"
// - old: "SEND to ABC12345" / "RECEIVED from ABC12345"
function extractOtherUserCode(reason) {
  if (!reason || typeof reason !== 'string') return null;

  // new format
  if (reason.startsWith('SEND_TO:')) return reason.replace('SEND_TO:', '').trim();
  if (reason.startsWith('RECEIVE_FROM:')) return reason.replace('RECEIVE_FROM:', '').trim();

  // old format
  if (reason.startsWith('SEND to ')) return reason.replace('SEND to ', '').trim();
  if (reason.startsWith('RECEIVED from ')) return reason.replace('RECEIVED from ', '').trim();

  return null;
}

function buildHistoryText(row) {
  const pts = Number(row.points || 0);
  const absPts = Math.abs(pts);

  const reason = row.reason || '';
  const otherCode = extractOtherUserCode(reason);
  const otherName = otherCode ? (getUserNameByCode(otherCode) || otherCode) : null;

  // Transfer cases
  if (pts > 0 && (reason.startsWith('RECEIVE_FROM:') || reason.startsWith('RECEIVED from '))) {
    return `${absPts} reward points receive from ${otherName}`;
  }

  if (pts < 0 && (reason.startsWith('SEND_TO:') || reason.startsWith('SEND to '))) {
    return `${absPts} reward points send to ${otherName}`;
  }

  // QR earn example (if you use it later)
  // store reason like "QR:<CODE>"
  if (pts > 0 && typeof reason === 'string' && reason.startsWith('QR:')) {
    return `${absPts} reward points earned from QR scan`;
  }

  // fallback
  if (pts > 0) return `${absPts} reward points added`;
  if (pts < 0) return `${absPts} reward points deducted`;
  return `0 points`;
}

// ------------------------ SEND POINTS ------------------------

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

    // --- check sender balance (includes BASE_POINTS) ---
    const senderBalanceBefore = getEffectiveBalance(senderDbId);
    if (senderBalanceBefore < points) {
      return res.status(400).json({
        error: 'insufficient points',
        senderBalance: senderBalanceBefore
      });
    }

    // --- transaction: move points from sender -> receiver ---
    const transferTx = db.transaction(() => {
      // sender: negative
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(
        senderDbId,
        -points,
        `SEND_TO:${receiverCode}`,   // ✅ clean format
        now()
      );

      // receiver: positive
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(
        receiverDbId,
        points,
        `RECEIVE_FROM:${senderCode}`, // ✅ clean format
        now()
      );
    });

    transferTx();

    // balances after (includes BASE_POINTS)
    const senderBalanceAfter = getEffectiveBalance(senderDbId);
    const receiverBalanceAfter = getEffectiveBalance(receiverDbId);

    return res.status(201).json({
      fromUserId: senderCode,
      toUserId: receiverCode,
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

router.get('/', authRequired, (req, res) => {
  try {
    const dbUserId = req.user.id;
    const userCode = req.user.userCode;

    const dbTotal = getDbPointsTotal(dbUserId);
    const totalPoints = BASE_POINTS + dbTotal;

    const rows = db.prepare(`
      SELECT id, points, reason, createdAt
      FROM user_points
      WHERE userId = ?
      ORDER BY createdAt DESC, id DESC
    `).all(dbUserId);

    const history = rows.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      text: buildHistoryText(r),
    }));

    return res.json({
      userId: userCode,
      totalPoints,
      history
    });
  } catch (err) {
    console.error('[points.get] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
