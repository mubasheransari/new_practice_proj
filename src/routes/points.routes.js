// // // src/routes/points.routes.js

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
/**
 * POST /api/points/send
 * Body: { points: number, uid: string }
 *
 * - Sender = current logged-in user (from JWT)
 * - uid = receiver's userCode (8-char visible user id)
 * - BASE_POINTS (50) included in balances
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
/**
 * GET /api/points
 * - returns current user's total + history
 * - totalPoints includes BASE_POINTS (50)
 * - history includes readable "text"
 * - no null fields returned
 */
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


// // src/routes/points.routes.js
// const express = require('express');
// const { db, now } = require('../db');
// const { authRequired } = require('../middleware/auth');

// const router = express.Router();

// // ✅ Every user starts with 50 points by default
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

// function usernameOfRow(u) {
//   if (!u) return null;
//   const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
//   return name.length ? name : (u.userCode || 'Unknown');
// }

// // ------------------------ SEND POINTS ------------------------
// /**
//  * POST /api/points/send
//  * Body: { points: number, uid: string }
//  *
//  * - Sender = current logged-in user (from JWT)
//  * - uid = receiver's userCode (8-char visible user id)
//  * - default BASE_POINTS included in balances
//  * - all points are transferable
//  */
// router.post('/send', authRequired, (req, res) => {
//   try {
//     const { points, uid } = req.body || {};

//     const senderDbId = req.user.id;
//     const senderCode = req.user.userCode;

//     // --- validation ---
//     if (!Number.isInteger(points) || points <= 0) {
//       return res.status(400).json({ error: 'points must be a positive integer' });
//     }
//     if (!uid || typeof uid !== 'string' || !uid.trim()) {
//       return res.status(400).json({ error: 'uid (receiver userId) is required' });
//     }

//     // --- receiver ---
//     const receiver = db
//       .prepare('SELECT id, userCode, firstName, lastName FROM users WHERE userCode = ?')
//       .get(uid.trim());

//     if (!receiver) {
//       return res.status(404).json({ error: 'receiver not found for given uid' });
//     }

//     const receiverDbId = receiver.id;
//     const receiverCode = receiver.userCode;

//     if (receiverDbId === senderDbId) {
//       return res.status(400).json({ error: 'cannot send points to yourself' });
//     }

//     // --- sender balance ---
//     const senderBalanceBefore = getEffectiveBalance(senderDbId);
//     if (senderBalanceBefore < points) {
//       return res.status(400).json({
//         error: 'insufficient points',
//         senderBalance: senderBalanceBefore,
//       });
//     }

//     // --- transaction ---
//     const tx = db.transaction(() => {
//       // sender: negative
//       db.prepare(`
//         INSERT INTO user_points (userId, points, createdAt, fromUserId, toUserId)
//         VALUES (?,?,?,?,?)
//       `).run(
//         senderDbId,
//         -points,
//         now(),
//         senderDbId,
//         receiverDbId
//       );

//       // receiver: positive
//       db.prepare(`
//         INSERT INTO user_points (userId, points, createdAt, fromUserId, toUserId)
//         VALUES (?,?,?,?,?)
//       `).run(
//         receiverDbId,
//         points,
//         now(),
//         senderDbId,
//         receiverDbId
//       );
//     });

//     tx();

//     // balances after
//     const senderBalanceAfter = getEffectiveBalance(senderDbId);
//     const receiverBalanceAfter = getEffectiveBalance(receiverDbId);

//     return res.status(201).json({
//       fromUserId: senderCode,
//       toUserId: receiverCode,
//       points,
//       senderBalanceAfter,
//       receiverBalanceAfter,
//     });
//   } catch (err) {
//     console.error('[points.send] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// // ------------------------ GET POINTS ------------------------
// /**
//  * GET /api/points
//  * - returns current user's total + readable history
//  * - history shows: receive from / send to (username)
//  */
// router.get('/', authRequired, (req, res) => {
//   try {
//     const dbUserId = req.user.id;
//     const userCode = req.user.userCode;

//     const totalPoints = getEffectiveBalance(dbUserId);

//     // Pull history + join both users (sender/receiver)
//     const rows = db.prepare(`
//       SELECT
//         up.id,
//         up.userId,
//         up.points,
//         up.createdAt,
//         up.fromUserId,
//         up.toUserId,

//         fu.userCode AS fromUserCode,
//         fu.firstName AS fromFirstName,
//         fu.lastName AS fromLastName,

//         tu.userCode AS toUserCode,
//         tu.firstName AS toFirstName,
//         tu.lastName AS toLastName

//       FROM user_points up
//       LEFT JOIN users fu ON fu.id = up.fromUserId
//       LEFT JOIN users tu ON tu.id = up.toUserId
//       WHERE up.userId = ?
//       ORDER BY up.createdAt DESC, up.id DESC
//     `).all(dbUserId);

//     const history = rows.map(r => {
//       // If you are the receiver: points positive & toUserId==you
//       if (r.points > 0 && r.toUserId === dbUserId) {
//         const fromName = usernameOfRow({
//           userCode: r.fromUserCode,
//           firstName: r.fromFirstName,
//           lastName: r.fromLastName,
//         });

//         return {
//           id: r.id,
//           points: r.points,
//           message: `${r.points} reward points receive from ${fromName}`,
//           createdAt: r.createdAt,
//         };
//       }

//       // If you are the sender: points negative & fromUserId==you
//       if (r.points < 0 && r.fromUserId === dbUserId) {
//         const toName = usernameOfRow({
//           userCode: r.toUserCode,
//           firstName: r.toFirstName,
//           lastName: r.toLastName,
//         });

//         return {
//           id: r.id,
//           points: r.points, // keep negative if you want
//           message: `${Math.abs(r.points)} reward points send to ${toName}`,
//           createdAt: r.createdAt,
//         };
//       }

//       // Other entries (e.g. QR rewards, admin adjustments, etc.)
//       return {
//         id: r.id,
//         points: r.points,
//         message: `${r.points} reward points`,
//         createdAt: r.createdAt,
//       };
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

// const express = require('express');
// const { db, now } = require('../db');
// const { authRequired } = require('../middleware/auth');

// const router = express.Router();

// // ✅ Every user starts with 50 points by default (transferable)
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

// function getUserNameByUserCode(userCode) {
//   if (!userCode) return null;
//   const u = db
//     .prepare('SELECT firstName, lastName FROM users WHERE userCode = ?')
//     .get(String(userCode).trim());
//   if (!u) return null;
//   const full = `${u.firstName || ''} ${u.lastName || ''}`.trim();
//   return full || null;
// }

// function mapHistoryRow(row) {
//   const base = {
//     id: row.id,
//     points: row.points,
//     createdAt: row.createdAt,
//   };

//   const reason = (row.reason || '').trim();
//   const absPts = Math.abs(Number(row.points || 0));

//   // SEND to XXXXXXXX
//   if (reason.startsWith('SEND to ')) {
//     const code = reason.replace('SEND to ', '').trim();
//     const name = getUserNameByUserCode(code) || code;
//     return { ...base, send_to: `${absPts} send to ${name}` };
//   }

//   // RECEIVED from XXXXXXXX
//   if (reason.startsWith('RECEIVED from ')) {
//     const code = reason.replace('RECEIVED from ', '').trim();
//     const name = getUserNameByUserCode(code) || code;
//     return { ...base, receive_from: `${absPts} receive from ${name}` };
//   }

//   // QR redeem / other earning (optional friendly label)
//   if (reason.startsWith('QR_REDEEM')) {
//     return { ...base, earned_by: 'QR scan' };
//   }

//   // fallback: omit reason completely (no null fields)
//   return base;
// }

// // ------------------------ SEND POINTS ------------------------
// /**
//  * POST /api/points/send
//  * Body: { points: number, uid: string }
//  *
//  * - Sender = current logged-in user (from JWT)
//  * - uid = receiver's userCode (8-char visible user id)
//  * - BASE_POINTS is included in balance
//  * - all points are transferable
//  */
// router.post('/send', authRequired, (req, res) => {
//   try {
//     const { points, uid } = req.body || {};

//     const senderDbId = req.user.id;        // numeric DB id
//     const senderCode = req.user.userCode;  // 8-char visible ID

//     if (!Number.isInteger(points) || points <= 0) {
//       return res.status(400).json({ error: 'points must be a positive integer' });
//     }

//     if (!uid || typeof uid !== 'string' || !uid.trim()) {
//       return res.status(400).json({ error: 'uid (receiver userId) is required' });
//     }

//     const receiver = db
//       .prepare('SELECT id, userCode FROM users WHERE userCode = ?')
//       .get(uid.trim());

//     if (!receiver) {
//       return res.status(404).json({ error: 'receiver not found for given uid' });
//     }

//     const receiverDbId = receiver.id;
//     const receiverCode = receiver.userCode;

//     if (receiverDbId === senderDbId) {
//       return res.status(400).json({ error: 'cannot send points to yourself' });
//     }

//     const senderBalanceBefore = getEffectiveBalance(senderDbId);
//     if (senderBalanceBefore < points) {
//       return res.status(400).json({
//         error: 'insufficient points',
//         senderBalance: senderBalanceBefore,
//       });
//     }

//     const transferTx = db.transaction(() => {
//       db.prepare(`
//         INSERT INTO user_points (userId, points, reason, createdAt)
//         VALUES (?,?,?,?)
//       `).run(senderDbId, -points, `SEND to ${receiverCode}`, now());

//       db.prepare(`
//         INSERT INTO user_points (userId, points, reason, createdAt)
//         VALUES (?,?,?,?)
//       `).run(receiverDbId, points, `RECEIVED from ${senderCode}`, now());
//     });

//     transferTx();

//     return res.status(201).json({
//       fromUserId: senderCode,
//       toUserId: receiverCode,
//       points,
//       senderBalanceAfter: getEffectiveBalance(senderDbId),
//       receiverBalanceAfter: getEffectiveBalance(receiverDbId),
//     });
//   } catch (err) {
//     console.error('[points.send] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// // ------------------------ GET POINTS ------------------------
// /**
//  * GET /api/points
//  * - returns current user's own total + history
//  * - totalPoints includes default 50
//  * - history uses send_to / receive_from (no null fields)
//  */
// router.get('/', authRequired, (req, res) => {
//   try {
//     const dbUserId = req.user.id;
//     const userCode = req.user.userCode;

//     const rows = db.prepare(`
//       SELECT id, points, reason, createdAt
//       FROM user_points
//       WHERE userId = ?
//       ORDER BY createdAt DESC, id DESC
//     `).all(dbUserId);

//     return res.json({
//       userId: userCode,
//       totalPoints: getEffectiveBalance(dbUserId),
//       history: rows.map(mapHistoryRow),
//     });
//   } catch (err) {
//     console.error('[points.get] error:', err);
//     return res.status(500).json({ error: 'internal server error' });
//   }
// });

// module.exports = router;

