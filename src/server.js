require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');
const http       = require('http'); // Required for Socket.IO
const { Server } = require('socket.io'); // The Real-Time Engine

const authRoutes    = require('./routes/auth');
const videoRoutes   = require('./routes/videos');
const userRoutes    = require('./routes/users');
const youtubeRoutes = require('./routes/youtube');

const app  = express();
const server = http.createServer(app); // Wrap Express inside Node's HTTP server

// ── 1. GLOBAL CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder'],
  exposedHeaders: ['Bypass-Tunnel-Reminder']
}));
app.options('*', cors());

// ── 2. Proxy & Security ─────────────────────────────────────────────
app.set('trust proxy', 1); 
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));

// ── 3. Body Parsing & Logging ────────────────────────────────────────
app.use(express.json({ limit: '100mb' })); 
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(compression());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ── 4. Rate Limiter ──────────────────────────────────────────────────
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);

// ── 5. API Routes ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'UNLEASHED' }));
app.use('/api/auth',    authRoutes);
app.use('/api/videos',  videoRoutes);
app.use('/api/users',   userRoutes);
app.use('/api/youtube', youtubeRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── 6. REAL-TIME ENGINE (SOCKET.IO) ──────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: "*", // Allow your GitHub Pages frontend to connect
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('⚡ A user connected to the real-time matrix:', socket.id);

  // When a user clicks "Start Review", they join a specific video room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`👤 User ${socket.id} joined review room: ${roomId}`);
    
    // Tell everyone else in the room that someone arrived
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// ── 7. START SERVER ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000');
// Notice we use server.listen now, NOT app.listen!
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🦁 BeastVault Unleashed with WebSockets on Port ${PORT}`);
});

module.exports = server;