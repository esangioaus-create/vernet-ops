const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const { db, init } = require('./database/db');

// Init DB
init();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: 'vernet-ops-secret-2026-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// Inject io into requests
app.use((req, res, next) => { req.io = io; next(); });

// Routes
const authRouter = require('./routes/auth');
const briefingsRouter = require('./routes/briefings');
const alertsRouter = require('./routes/alerts');
const announcementsRouter = require('./routes/announcements');
const chatRouter = require('./routes/chat');
const deductionsRouter = require('./routes/deductions');
const { handoverRouter, maintenanceRouter } = require('./routes/operations');

app.use('/api/auth', authRouter);
app.use('/api/briefings', briefingsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/deductions', deductionsRouter);
app.use('/api/handovers', handoverRouter);
app.use('/api/maintenance', maintenanceRouter);

// Admin: get hotels list
app.get('/api/hotels', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  const hotels = db.prepare('SELECT id, name, slug FROM hotels WHERE active = 1').all();
  res.json(hotels);
});

// Admin: get users
app.get('/api/users', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  const hotelId = req.session.hotelId;
  const users = db.prepare(`
    SELECT id, display_name, username, role, service, active
    FROM users WHERE hotel_id = ? ORDER BY role, display_name
  `).all(hotelId);
  res.json(users);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Socket.io ─────────────────────────────────────────────────────────────────

// Share session with Socket.io
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.on('connection', (socket) => {
  const session = socket.request.session;
  if (!session.userId) { socket.disconnect(); return; }

  const hotelId = session.hotelId;
  if (hotelId) socket.join(`hotel_${hotelId}`);
  socket.join(`user_${session.userId}`);

  console.log(`🔌 ${session.userId} connecté (hôtel ${hotelId})`);

  // Chat message
  socket.on('chat_message', ({ service, message }) => {
    if (!message || !service) return;

    const user = db.prepare('SELECT display_name, service, role FROM users WHERE id = ?').get(session.userId);
    if (!user) return;

    const result = db.prepare(`
      INSERT INTO chat_messages (hotel_id, service, user_id, message)
      VALUES (?, ?, ?, ?)
    `).run(hotelId, service, session.userId, message.trim());

    const msg = {
      id: result.lastInsertRowid,
      hotel_id: hotelId,
      service,
      user_id: session.userId,
      author_name: user.display_name,
      author_service: user.service,
      author_role: user.role,
      message: message.trim(),
      created_at: new Date().toISOString()
    };

    io.to(`hotel_${hotelId}`).emit('chat_message', msg);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 ${session.userId} déconnecté`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         VERNET OPS v2.0 — DÉMARRÉ        ║');
  console.log(`║   http://localhost:${PORT}                   ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Comptes démo (mdp: vernet2026)          ║');
  console.log('║  etienne / alizee / julien / reception1  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});
