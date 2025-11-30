require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const { ensureDb } = require('./db');

// init DB / seed admin+skus (from ENV)
ensureDb();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Health
app.get('/health', (_, res) => res.json({ ok: true }));

// APIs
app.use('/api/auth',       require('./routes/auth.routes'));
app.use('/api/sales',      require('./routes/sales.routes'));
app.use('/api/attendance', require('./routes/attendance.routes'));
app.use('/api/profile',    require('./routes/profile.routes'));
app.use('/api/skus',       require('./routes/skus'));
app.use('/api/admin',      require('./routes/admin.routes'));

// ---- Admin panel (static SPA) ----

// 1) Serve built static assets under /admin
app.use('/admin', express.static(path.resolve(__dirname, '..', 'public', 'admin')));

// 2) SPA fallback for ANY /admin or /admin/... route (Express 5 + path-to-regexp v8 safe)
app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'admin', 'index.html'));
});

// (optional) root
app.get('/', (_, res) => res.status(404).json({ ok: false, message: 'Use /admin or /api/*' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
