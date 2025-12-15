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

// Parse our stored reason formats:
// "SEND to ABCD1234" or "RECEIVED from ABCD1234"
function parseTransferReason(reason) {
  if (!reason || typeof reason !== 'string') return null;

  const sendMatch = reason.match(/^SEND to\s+([A-Za-z0-9]{8})$/i);
  if (sendMatch) return { type: 'send', otherUserCode: sendMatch[1].toUpperCase() };

  const recvMatch = reason.match(/^RECEIVED from\s+([A-Za-z0-9]{8})$/i);
  if (recvMatch) return { type: 'receive', otherUserCode: recvMatch[1].toUpperCase() };

  return null;
}

function getUserNamesByCodes(userCodes) {
  if (!userCodes || userCodes.length === 0) return new Map();

  // build (?, ?, ?) placeholders
  const placeholders = userCodes.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT userCode, firstName, lastName
    FROM users
    WHERE userCode IN (${placeholders})
  `).all(...userCodes);

  const map = new Map();
  for (const r of rows) {
    const full = `${r.firstName || ''} ${(r.lastName || '')}`.trim();
    map.set(String(r.userCode).toUpperCase(), full || String(r.userCode).toUpperCase());
  }
  return map;
}

// ------------------------ SEND POINTS ------------------------
/**
 * POST /api/points/send
 * Body: { points: number, uid: string }
 *
 * - Sender = current logged-in user (from JWT)
 * - uid = receiver's userCode (8-char visible user id)
 * - totalPoints includes default 50
 * - all points are transferable
 */
router.post('/send', authRequired, (req, res) => {
  try {
    const { points, uid } = req.body || {};
    const senderDbId = req.user.id;
    const senderCode = String(req.user.userCode || '').toUpperCase();

    // validation
    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: 'points must be a positive integer' });
    }
    if (!uid || typeof uid !== 'string' || !uid.trim()) {
      return res.status(400).json({ error: 'uid (receiver userId) is required' });
    }

    const receiver = db
      .prepare('SELECT id, userCode FROM users WHERE userCode = ?')
      .get(uid.trim().toUpperCase());

    if (!receiver) {
      return res.status(404).json({ error: 'receiver not found for given uid' });
    }

    const receiverDbId = receiver.id;
    const receiverCode = String(receiver.userCode).toUpperCase();

    if (receiverDbId === senderDbId) {
      return res.status(400).json({ error: 'cannot send points to yourself' });
    }

    // balance check (includes base 50)
    const senderBalanceBefore = getEffectiveBalance(senderDbId);
    if (senderBalanceBefore < points) {
      return res.status(400).json({
        error: 'insufficient points',
        senderBalance: senderBalanceBefore,
      });
    }

    // transaction
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(senderDbId, -points, `SEND to ${receiverCode}`, now());

      db.prepare(`
        INSERT INTO user_points (userId, points, reason, createdAt)
        VALUES (?,?,?,?)
      `).run(receiverDbId, points, `RECEIVED from ${senderCode}`, now());
    });

    tx();

    // balances after
    const senderBalanceAfter = getEffectiveBalance(senderDbId);
    const receiverBalanceAfter = getEffectiveBalance(receiverDbId);

    // Optional: include nice messages here too
    // (You can remove these if you only want balances.)
    const senderNameRow = db
      .prepare('SELECT firstName, lastName FROM users WHERE id = ?')
      .get(senderDbId);
    const receiverNameRow = db
      .prepare('SELECT firstName, lastName FROM users WHERE id = ?')
      .get(receiverDbId);

    const senderName = `${senderNameRow?.firstName || ''} ${senderNameRow?.lastName || ''}`.trim() || senderCode;
    const receiverName = `${receiverNameRow?.firstName || ''} ${receiverNameRow?.lastName || ''}`.trim() || receiverCode;

    return res.status(201).json({
      fromUserId: senderCode,
      toUserId: receiverCode,
      points,
      senderBalanceAfter,
      receiverBalanceAfter,
      message: `${points} send to ${receiverName}`,
      receiverMessage: `${points} receive from ${senderName}`,
    });
  } catch (err) {
    console.error('[points.send] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------ GET POINTS ------------------------
/**
 * GET /api/points
 * - returns current user's total + history
 * - totalPoints includes default 50
 * - history returns:
 *    - receive_from only if received
 *    - send_to only if sent
 *   (no null fields)
 */
router.get('/', authRequired, (req, res) => {
  try {
    const dbUserId = req.user.id;
    const userCode = String(req.user.userCode || '').toUpperCase();

    const dbTotal = getDbPointsTotal(dbUserId);
    const totalPoints = BASE_POINTS + dbTotal;

    // get history with reason
    const rows = db.prepare(`
      SELECT id, points, reason, createdAt
      FROM user_points
      WHERE userId = ?
      ORDER BY createdAt DESC, id DESC
    `).all(dbUserId);

    // collect other userCodes from reasons (for name lookup)
    const neededCodes = new Set();
    for (const r of rows) {
      const parsed = parseTransferReason(r.reason);
      if (parsed?.otherUserCode) neededCodes.add(parsed.otherUserCode);
    }

    const nameMap = getUserNamesByCodes([...neededCodes]);

    // build output history (no null fields)
    const history = rows.map((r) => {
      const base = {
        id: r.id,
        points: r.points,
        createdAt: r.createdAt,
      };

      const parsed = parseTransferReason(r.reason);
      if (!parsed) return base;

      const otherName = nameMap.get(parsed.otherUserCode) || parsed.otherUserCode;
      const absPoints = Math.abs(Number(r.points));

      if (parsed.type === 'receive' && r.points > 0) {
        return {
          ...base,
          receive_from: `${absPoints} receive from ${otherName}`,
        };
      }

      if (parsed.type === 'send' && r.points < 0) {
        return {
          ...base,
          send_to: `${absPoints} send to ${otherName}`,
        };
      }

      return base;
    });

    return res.json({
      userId: userCode,
      totalPoints,
      history,
    });
  } catch (err) {
    console.error('[points.get] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
