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
app.use('/api/points',     require('./routes/points.routes'));

// ---- Admin Panel (static SPA) ----

// Serve static admin files
app.use('/admin', express.static(path.resolve(__dirname, '..', 'public', 'admin')));

// SPA Fallback (Express 5 compatible)
app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'admin', 'index.html'));
});

// Root
app.get('/', (_, res) => res.status(404).json({
  ok: false,
  message: 'Use /admin or /api/*'
}));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
