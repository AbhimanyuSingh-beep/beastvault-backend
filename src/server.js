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

// ── 1. GLOBAL CORS (MUST BE FIRST) ──────────────────────────────────
app.use(cors({
  origin: '*', // Allows your GitHub site to talk to your local computer
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder'],
  exposedHeaders: ['Bypass-Tunnel-Reminder']
}));

// ── 2. Handle OPTIONS preflights manually (Extra Safety) ────────────
app.options('*', cors());

// ── 3. Proxy & Security ─────────────────────────────────────────────
app.set('trust proxy', 1); 
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
}));

// ── 4. Body Parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '100mb' })); 
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(compression());

// ── 5. Logging ───────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── 6. Global rate limiters (Moved down) ─────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000, // Increased for testing
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', generalLimiter);

// ── 7. API Routes ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'UNLEASHED' }));
app.use('/api/auth',   authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/users',  userRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

const PORT = parseInt(process.env.PORT || '4000');
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦁 BeastVault Unleashed on Port ${PORT}`);
});

module.exports = app;