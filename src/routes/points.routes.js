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



// // src/routes/points.routes.js
// const express = require('express');
// const { db, now } = require('../db');
// const { authRequired } = require('../middleware/auth');

// const router = express.Router();

// // ✅ Every user starts with 50 points by default
// // i want a post api that will add multiple numbers and single number both and from these numbers qr will generate on packets i will scan qr code through api and app will check through post api that this number exist if this number exists on database then user will get points from that sucessful scan and this scan will work only 1 time 1 scan at one time only and if user tries to scan again then it will get error message "qr already scanned". i want all the updations as per statement. im ataching my whole code zip code for analysis.
// const BASE_POINTS = 50;

// // ------------------------ helpers ------------------------
// function getDbPointsTotal(dbUserId) {
//   const row = db
//     .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
//     .get(dbUserId);

//   return Number(row?.totalPoints || 0);
// }

// function getEffectiveBalance(dbUserId) {
//   return BASE_POINTS + getDbPointsTotal(dbUserId);
// }

// // Parse our stored reason formats:
// // "SEND to ABCD1234" or "RECEIVED from ABCD1234"
// function parseTransferReason(reason) {
//   if (!reason || typeof reason !== 'string') return null;

//   const sendMatch = reason.match(/^SEND to\s+([A-Za-z0-9]{8})$/i);
//   if (sendMatch) return { type: 'send', otherUserCode: sendMatch[1].toUpperCase() };

//   const recvMatch = reason.match(/^RECEIVED from\s+([A-Za-z0-9]{8})$/i);
//   if (recvMatch) return { type: 'receive', otherUserCode: recvMatch[1].toUpperCase() };

//   return null;
// }

// function getUserNamesByCodes(userCodes) {
//   if (!userCodes || userCodes.length === 0) return new Map();

//   // build (?, ?, ?) placeholders
//   const placeholders = userCodes.map(() => '?').join(',');

//   const rows = db.prepare(`
//     SELECT userCode, firstName, lastName
//     FROM users
//     WHERE userCode IN (${placeholders})
//   `).all(...userCodes);

//   const map = new Map();
//   for (const r of rows) {
//     const full = `${r.firstName || ''} ${(r.lastName || '')}`.trim();
//     map.set(String(r.userCode).toUpperCase(), full || String(r.userCode).toUpperCase());
//   }
//   return map;
// }

// // ------------------------ SEND POINTS ------------------------
// /** 
//  * POST /api/points/send
//  * Body: { points: number, uid: string }
//  *
//  * - Sender = current logged-in user (from JWT)
//  * - uid = receiver's userCode (8-char visible user id)
//  * - totalPoints includes default 50
//  * - all points are transferable
//  */
// router.post('/send', authRequired, (req, res) => {
//   try {
//     const { points, uid } = req.body || {};
//     const senderDbId = req.user.id;
//     const senderCode = String(req.user.userCode || '').toUpperCase();

//     // validation
//     if (!Number.isInteger(points) || points <= 0) {
//       return res.status(400).json({ error: 'points must be a positive integer' });
//     }
//     if (!uid || typeof uid !== 'string' || !uid.trim()) {
//       return res.status(400).json({ error: 'uid (receiver userId) is required' });
//     }

//     const receiver = db
//       .prepare('SELECT id, userCode FROM users WHERE userCode = ?')
//       .get(uid.trim().toUpperCase());

//     if (!receiver) {
//       return res.status(404).json({ error: 'receiver not found for given uid' });
//     }

//     const receiverDbId = receiver.id;
//     const receiverCode = String(receiver.userCode).toUpperCase();

//     if (receiverDbId === senderDbId) {
//       return res.status(400).json({ error: 'cannot send points to yourself' });
//     }

//     // balance check (includes base 50)
//     const senderBalanceBefore = getEffectiveBalance(senderDbId);
//     if (senderBalanceBefore < points) {
//       return res.status(400).json({
//         error: 'insufficient points',
//         senderBalance: senderBalanceBefore,
//       });
//     }

//     // transaction
//     const tx = db.transaction(() => {
//       db.prepare(`
//         INSERT INTO user_points (userId, points, reason, createdAt)
//         VALUES (?,?,?,?)
//       `).run(senderDbId, -points, `SEND to ${receiverCode}`, now());

//       db.prepare(`
//         INSERT INTO user_points (userId, points, reason, createdAt)
//         VALUES (?,?,?,?)
//       `).run(receiverDbId, points, `RECEIVED from ${senderCode}`, now());
//     });

//     tx();

//     // balances after
//     const senderBalanceAfter = getEffectiveBalance(senderDbId);
//     const receiverBalanceAfter = getEffectiveBalance(receiverDbId);

//     // Optional: include nice messages here too
//     // (You can remove these if you only want balances.)
//     const senderNameRow = db
//       .prepare('SELECT firstName, lastName FROM users WHERE id = ?')
//       .get(senderDbId);
//     const receiverNameRow = db
//       .prepare('SELECT firstName, lastName FROM users WHERE id = ?')
//       .get(receiverDbId);

//     const senderName = `${senderNameRow?.firstName || ''} ${senderNameRow?.lastName || ''}`.trim() || senderCode;
//     const receiverName = `${receiverNameRow?.firstName || ''} ${receiverNameRow?.lastName || ''}`.trim() || receiverCode;

//     return res.status(201).json({
//       fromUserId: senderCode,
//       toUserId: receiverCode,
//       points,
//       senderBalanceAfter,
//       receiverBalanceAfter,
//       message: `${points} send to ${receiverName}`,
//       receiverMessage: `${points} receive from ${senderName}`,
//     });
//   } catch (err) {
//     console.error('[points.send] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// // ------------------------ GET POINTS ------------------------
// /**
//  * GET /api/points
//  * - returns current user's total + history
//  * - totalPoints includes default 50
//  * - history returns:
//  *    - receive_from only if received
//  *    - send_to only if sent
//  *   (no null fields)
//  */
// router.get('/', authRequired, (req, res) => {
//   try {
//     const dbUserId = req.user.id;
//     const userCode = String(req.user.userCode || '').toUpperCase();

//     const dbTotal = getDbPointsTotal(dbUserId);
//     const totalPoints = BASE_POINTS + dbTotal;

//     // get history with reason
//     const rows = db.prepare(`
//       SELECT id, points, reason, createdAt
//       FROM user_points
//       WHERE userId = ?
//       ORDER BY createdAt DESC, id DESC
//     `).all(dbUserId);

//     // collect other userCodes from reasons (for name lookup)
//     const neededCodes = new Set();
//     for (const r of rows) {
//       const parsed = parseTransferReason(r.reason);
//       if (parsed?.otherUserCode) neededCodes.add(parsed.otherUserCode);
//     }

//     const nameMap = getUserNamesByCodes([...neededCodes]);

//     // build output history (no null fields)
//     const history = rows.map((r) => {
//       const base = {
//         id: r.id,
//         points: r.points,
//         createdAt: r.createdAt,
//       };

//       const parsed = parseTransferReason(r.reason);
//       if (!parsed) return base;

//       const otherName = nameMap.get(parsed.otherUserCode) || parsed.otherUserCode;
//       const absPoints = Math.abs(Number(r.points));

//       if (parsed.type === 'receive' && r.points > 0) {
//         return {
//           ...base,
//           receive_from: `${absPoints} receive from ${otherName}`,
//         };
//       }

//       if (parsed.type === 'send' && r.points < 0) {
//         return {
//           ...base,
//           send_to: `${absPoints} send to ${otherName}`,
//         };
//       }

//       return base;
//     });

//     return res.json({
//       userId: userCode,
//       totalPoints,
//       history,
//     });
//   } catch (err) {
//     console.error('[points.get] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// module.exports = router;
