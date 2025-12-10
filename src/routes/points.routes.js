// src/routes/points.routes.js
const express = require('express');
const { db, now } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/points/send
 * Body: { points: number, uid: string }
 *
 * - Sender = current logged-in user (from JWT)
 * - uid = receiver's userCode (8-char visible user id)
 */
router.post('/send', authRequired, (req, res) => {
  try {
    const { points, uid } = req.body || {};
    const senderDbId = req.user.id;        // numeric DB id from token
    const senderCode = req.user.userCode;  // 8-char visible ID from token

    // --- basic validation ---
    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: 'points must be a positive integer' });
    }

    if (!uid || typeof uid !== 'string') {
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

    // optional rule: cannot send to self
    if (receiverDbId === senderDbId) {
      return res.status(400).json({ error: 'cannot send points to yourself' });
    }

    // --- check sender balance ---
    const senderBalanceRow = db
      .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
      .get(senderDbId);

    const senderBalance = senderBalanceRow.totalPoints;

    if (senderBalance < points) {
      return res.status(400).json({ error: 'insufficient points' });
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

    // --- new balances after transfer ---
    const senderAfterRow = db
      .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
      .get(senderDbId);

    const receiverAfterRow = db
      .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
      .get(receiverDbId);

    return res.status(201).json({
      fromUserId: senderCode,                 // visible sender id (8-char)
      toUserId: receiverCode,                 // visible receiver id (8-char)
      points,
      senderBalanceAfter: senderAfterRow.totalPoints,
      receiverBalanceAfter: receiverAfterRow.totalPoints
    });
  } catch (err) {
    console.error('[points.send] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

/**
 * GET /api/points
 * - returns current user's own total + history
 */
router.get('/', authRequired, (req, res) => {
  try {
    const dbUserId = req.user.id;
    const userCode = req.user.userCode; // 8-char visible id

    const totalRow = db
      .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
      .get(dbUserId);

    const history = db.prepare(`
      SELECT id, points, reason, createdAt
      FROM user_points
      WHERE userId = ?
      ORDER BY createdAt DESC, id DESC
    `).all(dbUserId);

    return res.json({
      userId: userCode,
      totalPoints: totalRow.totalPoints,
      history
    });
  } catch (err) {
    console.error('[points.get] error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;


// const express = require('express');
// const { db, now } = require('../db');
// const { authRequired } = require('../middleware/auth');

// const router = express.Router();

// router.post('/send', authRequired, (req, res) => {
//   const { points, uid } = req.body || {};
//   const senderDbId = req.user.id;         // numeric DB id
//   const senderCode = req.user.userCode;   // 8-char visible ID

//   // basic validation
//   if (!Number.isInteger(points) || points <= 0) {
//     return res.status(400).json({ error: 'points must be a positive integer' });
//   }
//   if (!uid || typeof uid !== 'string') {
//     return res.status(400).json({ error: 'uid (receiver userId) is required' });
//   }

//   // find receiver by userCode
//   const receiver = db
//     .prepare('SELECT id, userCode FROM users WHERE userCode = ?')
//     .get(uid.trim());

//   if (!receiver) {
//     return res.status(404).json({ error: 'receiver not found for given uid' });
//   }

//   const receiverDbId = receiver.id;
//   const receiverCode = receiver.userCode;

//   // sender cannot send to self (optional rule)
//   if (receiverDbId === senderDbId) {
//     return res.status(400).json({ error: 'cannot send points to yourself' });
//   }

//   // check sender balance
//   const senderBalanceRow = db
//     .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
//     .get(senderDbId);

//   const senderBalance = senderBalanceRow.totalPoints;

//   if (senderBalance < points) {
//     return res.status(400).json({ error: 'insufficient points' });
//   }

//   // transaction: move points from sender -> receiver
//   const transferTx = db.transaction(() => {
//     // sender: negative points
//     db.prepare(`
//       INSERT INTO user_points (userId, points, reason, createdAt)
//       VALUES (?,?,?,?)
//     `).run(
//       senderDbId,
//       -points,
//       `SEND to ${receiverCode}`,
//       now()
//     );

//     // receiver: positive points
//     db.prepare(`
//       INSERT INTO user_points (userId, points, reason, createdAt)
//       VALUES (?,?,?,?)
//     `).run(
//       receiverDbId,
//       points,
//       `RECEIVED from ${senderCode}`,
//       now()
//     );
//   });

//   transferTx();

//   // new balances after transfer
//   const senderAfterRow = db
//     .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
//     .get(senderDbId);

//   const receiverAfterRow = db
//     .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
//     .get(receiverDbId);

//   return res.status(201).json({
//     fromUserId: senderCode,                     // visible sender id (8-char)
//     toUserId: receiverCode,                     // visible receiver id (8-char)
//     points,
//     senderBalanceAfter: senderAfterRow.totalPoints,
//     receiverBalanceAfter: receiverAfterRow.totalPoints
//   });
// });

// /**
//  * GET /api/points
//  * - still returns current user's own total + history
//  */
// router.get('/', authRequired, (req, res) => {
//   const dbUserId = req.user.id;
//   const userCode = req.user.userCode;

//   const totalRow = db
//     .prepare('SELECT COALESCE(SUM(points), 0) AS totalPoints FROM user_points WHERE userId = ?')
//     .get(dbUserId);

//   const history = db.prepare(`
//     SELECT id, points, reason, createdAt
//     FROM user_points
//     WHERE userId = ?
//     ORDER BY createdAt DESC, id DESC
//   `).all(dbUserId);

//   res.json({
//     userId: userCode,
//     totalPoints: totalRow.totalPoints,
//     history
//   });
// });

// module.exports = router;
