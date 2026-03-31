const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database/db');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiants manquants' });

  const user = db.prepare(`
    SELECT u.*, h.name as hotel_name, h.slug as hotel_slug
    FROM users u
    LEFT JOIN hotels h ON u.hotel_id = h.id
    WHERE u.username = ? AND u.active = 1
  `).get(username.trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  req.session.userId = user.id;
  req.session.hotelId = user.hotel_id;
  req.session.role = user.role;

  res.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    service: user.service,
    hotel_id: user.hotel_id,
    hotel_name: user.hotel_name,
    hotel_slug: user.hotel_slug
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT u.*, h.name as hotel_name, h.slug as hotel_slug
    FROM users u
    LEFT JOIN hotels h ON u.hotel_id = h.id
    WHERE u.id = ?
  `).get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const { password_hash, ...safe } = user;
  res.json(safe);
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
