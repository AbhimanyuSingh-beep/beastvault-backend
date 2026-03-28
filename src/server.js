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

// ── Render/Proxy Configuration ──────────────────────────────────────
app.set('trust proxy', 1); 

const PORT = parseInt(process.env.PORT || '4000');

// ── Security headers ─────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
}));

// ── CORS (THE FIX IS HERE) ───────────────────────────────────────────
app.use(cors({
  origin: '*', // Allow all origins (Netlify, GitHub Pages, etc.)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Bypass-Tunnel-Reminder' // <--- THIS WAS THE MISSING PIECE!
  ],
  credentials: true
}));

// ── Body parsing ─────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' })); // Increased limit for beast-sized metadata
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ── Logging ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Global rate limiters ─────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down, beast!' },
});

app.use('/api/', generalLimiter);

// ── Health check ─────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now(), mode: 'UNLEASHED' }));

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
  ╔══════════════════════════════════════════╗
  ║    🦁  BeastVault API — UNLEASHED        ║
  ║    URL: http://localhost:${PORT}             ║
  ║    CORS: BYPASS-TUNNEL-REMINDER ALLOWED  ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;