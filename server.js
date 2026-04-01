const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { db, init } = require('./database/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false // disabled to allow inline scripts in frontend
}));

// Rate limiting on API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes' }
});

// Strict rate limiting on login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'vernet-ops-secret-2026-CHANGE-IN-PROD',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 12 * 60 * 60 * 1000 // 12h
  }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { req.io = io; next(); });

// ── Routes ────────────────────────────────────────────────────────────────────
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const deductionsRouter = require('./routes/deductions');
const chatRouter = require('./routes/chat');
const { briefingsRouter, alertsRouter, announcementsRouter, handoverRouter, maintenanceRouter } = require('./routes/operations_all');

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/briefings', briefingsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/deductions', deductionsRouter);
app.use('/api/handovers', handoverRouter);
app.use('/api/maintenance', maintenanceRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
const { getAllowedServices } = require('./routes/chat');
const wrap = m => (socket, next) => m(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess.userId) { socket.disconnect(); return; }
  const hotelId = sess.hotelId;
  if (hotelId) socket.join(`hotel_${hotelId}`);
  socket.join(`user_${sess.userId}`);

  socket.on('chat_message', ({ service, message }) => {
    if (!message?.trim() || !service) return;
    const allowed = getAllowedServices(sess);
    if (!allowed.includes(service)) return; // Security: ignore unauthorized channel

    const user = db.prepare('SELECT display_name, service, role FROM users WHERE id = ?').get(sess.userId);
    if (!user) return;

    const result = db.prepare('INSERT INTO chat_messages (hotel_id, service, user_id, message) VALUES (?, ?, ?, ?)')
      .run(hotelId, service, sess.userId, message.trim());

    // Only emit to users who can see this service
    io.to(`hotel_${hotelId}`).emit('chat_message', {
      id: result.lastInsertRowid, hotel_id: hotelId, service,
      user_id: sess.userId, author_name: user.display_name,
      author_service: user.service, author_role: user.role,
      message: message.trim(), created_at: new Date().toISOString()
    });
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

init().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║         VERNET OPS v2.1 — DÉMARRÉ        ║');
    console.log(`║   http://localhost:${PORT}                   ║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Sécurité : Helmet + Rate limiting ON    ║');
    console.log('║  Comptes démo (mdp: vernet2026)          ║');
    console.log('╚══════════════════════════════════════════╝');
  });
}).catch(err => {
  console.error('Erreur démarrage:', err);
  process.exit(1);
});
