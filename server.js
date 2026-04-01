const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const { db, init } = require('./database/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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

app.get('/api/hotels', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  res.json(db.prepare('SELECT id, name, slug FROM hotels WHERE active = 1').all());
});

app.get('/api/users', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  res.json(db.prepare(`
    SELECT id, display_name, username, role, service, active
    FROM users WHERE hotel_id = ? ORDER BY role, display_name
  `).all(req.session.hotelId));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io
const wrap = m => (socket, next) => m(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess.userId) { socket.disconnect(); return; }
  const hotelId = sess.hotelId;
  if (hotelId) socket.join(`hotel_${hotelId}`);
  socket.join(`user_${sess.userId}`);

  socket.on('chat_message', ({ service, message }) => {
    if (!message || !service) return;
    const user = db.prepare('SELECT display_name, service, role FROM users WHERE id = ?').get(sess.userId);
    if (!user) return;
    const result = db.prepare('INSERT INTO chat_messages (hotel_id, service, user_id, message) VALUES (?, ?, ?, ?)')
      .run(hotelId, service, sess.userId, message.trim());
    io.to(`hotel_${hotelId}`).emit('chat_message', {
      id: result.lastInsertRowid, hotel_id: hotelId, service,
      user_id: sess.userId, author_name: user.display_name,
      author_service: user.service, author_role: user.role,
      message: message.trim(), created_at: new Date().toISOString()
    });
  });
});

const PORT = process.env.PORT || 3000;

// Init DB then start server
init().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║         VERNET OPS v2.0 — DÉMARRÉ        ║');
    console.log(`║   http://localhost:${PORT}                   ║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Comptes démo (mdp: vernet2026)          ║');
    console.log('║  etienne / alizee / julien / reception1  ║');
    console.log('╚══════════════════════════════════════════╝');
  });
}).catch(err => {
  console.error('Erreur démarrage:', err);
  process.exit(1);
});
