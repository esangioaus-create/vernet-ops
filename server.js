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
app.use(helmet({ contentSecurityPolicy: false }));

app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 500, message: { error: 'Trop de requêtes' } }));
app.use('/api/auth/login', rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Trop de tentatives' } }));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded/archived files statically (authenticated via route)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'vernet-ops-secret-2026-CHANGE-IN-PROD',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // false for local network HTTP
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

app.get('/api/hotels', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  res.json(db.prepare('SELECT id, name, slug FROM hotels WHERE active = 1 ORDER BY name').all());
});
app.get('/api/users', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  res.json(db.prepare('SELECT id, display_name, username, role, service, active FROM users WHERE hotel_id = ? ORDER BY role, display_name').all(req.session.hotelId));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
    if (!allowed.includes(service)) return;
    const user = db.prepare('SELECT display_name, service, role FROM users WHERE id = ?').get(sess.userId);
    if (!user) return;
    const result = db.prepare('INSERT INTO chat_messages (hotel_id, service, user_id, message) VALUES (?, ?, ?, ?)').run(hotelId, service, sess.userId, message.trim());
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
    console.log('║        VERNET OPS v2.2 — DÉMARRÉ         ║');
    console.log(`║   http://localhost:${PORT}                   ║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Fichiers → ./uploads/deductions/        ║');
    console.log('║  Archives → ./archives/deductions/       ║');
    console.log('╚══════════════════════════════════════════╝');
  });
}).catch(err => { console.error('Erreur démarrage:', err); process.exit(1); });
