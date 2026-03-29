require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');
const http       = require('http'); 
const { Server } = require('socket.io'); 

const authRoutes    = require('./routes/auth');
const videoRoutes   = require('./routes/videos');
const userRoutes    = require('./routes/users');
const youtubeRoutes = require('./routes/youtube');

const app  = express();
const server = http.createServer(app); 

// ── 1. GLOBAL CORS CONFIG ───────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder'],
  exposedHeaders: ['Bypass-Tunnel-Reminder']
}));
app.options('*', cors());

// ── 2. SECURITY & PROXY ────────────────────────────────────────────
app.set('trust proxy', 1); 
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));

// ── 3. BODY PARSING & COMPRESSION ───────────────────────────────────
app.use(express.json({ limit: '100mb' })); 
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(compression());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ── 4. RATE LIMITING ────────────────────────────────────────────────
const generalLimiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 2000, 
  standardHeaders: true, 
  legacyHeaders: false 
});
app.use('/api/', generalLimiter);

// ── 5. API ROUTES ───────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'BEAST_READY' }));
app.use('/api/auth',    authRoutes);
app.use('/api/videos',  videoRoutes);
app.use('/api/users',   userRoutes);
app.use('/api/youtube', youtubeRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── 6. REAL-TIME ENGINE (SOCKET.IO MASTER) ──────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
  console.log('⚡ User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    
    // Track members and notify the room
    const memberCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    io.to(roomId).emit('room-metrics', { members: memberCount });
    
    // Tell others a new beast has joined
    socket.to(roomId).emit('user-joined', socket.id);
  });

  // Relay Video Player Sync (Play, Pause, Seek)
  socket.on('video-action', (data) => {
    socket.to(data.room).emit('video-action', data);
  });

  // Relay Real-time Thought Board / Code Sync
  socket.on('sync-thoughts', (data) => {
    socket.to(data.room).emit('sync-thoughts', data);
  });

  // NEW: State Synchronization Logic
  // Allows new joiners to request the current video time/text from existing users
  socket.on('request-room-state', (data) => {
    socket.to(data.room).emit('request-room-state', { requester: socket.id });
  });

  socket.on('send-room-state', (data) => {
    io.to(data.to).emit('receive-room-state', data.state);
  });

  // WebRTC Live Calling Relays
  socket.on('webrtc-offer', (data) => {
    socket.to(data.room).emit('webrtc-offer', data.offer);
  });
  socket.on('webrtc-answer', (data) => {
    socket.to(data.room).emit('webrtc-answer', data.answer);
  });
  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.room).emit('webrtc-ice-candidate', data.candidate);
  });

  socket.on('disconnecting', () => {
    // Update member count for all rooms this socket was in
    socket.rooms.forEach(roomId => {
        const count = (io.sockets.adapter.rooms.get(roomId)?.size || 1) - 1;
        io.to(roomId).emit('room-metrics', { members: count });
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// ── 7. START ENGINE ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000');
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🦁 BeastVault Pro Engine Live on Port ${PORT}`);
});

module.exports = server;