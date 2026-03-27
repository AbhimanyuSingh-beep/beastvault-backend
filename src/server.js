require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');

const authRoutes  = require('./routes/auth');
const videoRoutes = require('./routes/videos');
const userRoutes  = require('./routes/users');

const app  = express();
const PORT = parseInt(process.env.PORT || '4000');

// ── Security headers ─────────────────────────────────────────────────
// Updated Helmet to allow cross-origin resources (videos/images)
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
}));

// ── CORS ─────────────────────────────────────────────────────────────
// UNLOCKED: Allowing all origins so your local .html file can connect
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsing ─────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(compression());

// ── Logging ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Global rate limiters ─────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Increased for testing
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down, beast!' },
});

app.use('/api/', generalLimiter);

// ── Health check ─────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── API Routes ────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/users',  userRoutes);

// ── 404 handler ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🦁  BeastVault API — UNLEASHED     ║
  ║   http://localhost:${PORT}              ║
  ║   CORS: OPEN (Development Mode)      ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;