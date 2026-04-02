const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database/db');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiants manquants' });

  const user = db.prepare(`
    SELECT u.*, h.name as hotel_name, h.slug as hotel_slug
    FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id
    WHERE u.username = ? AND u.active = 1
  `).get(username.trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  req.session.userId = user.id;
  req.session.hotelId = user.hotel_id;
  req.session.role = user.role;
  req.session.service = user.service;

  res.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    first_name: user.first_name,
    last_name: user.last_name,
    poste: user.poste,
    role: user.role,
    service: user.service,
    hotel_id: user.hotel_id,
    hotel_name: user.hotel_name,
    hotel_slug: user.hotel_slug,
    must_change_password: user.must_change_password === 1
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT u.*, h.name as hotel_name, h.slug as hotel_slug
    FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id
    WHERE u.id = ?
  `).get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const { password_hash, ...safe } = user;
  safe.must_change_password = safe.must_change_password === 1;
  res.json(safe);
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Champs requis' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 12), req.session.userId);

  res.json({ ok: true });
});

// First login: set new password without knowing the old one (only if must_change_password = 1)
router.post('/first-login', requireAuth, (req, res) => {
  const { new_password } = req.body;
  if (!new_password) return res.status(400).json({ error: 'Mot de passe requis' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user.must_change_password) return res.status(400).json({ error: 'Non applicable' });

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 12), req.session.userId);

  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Non autorisé' });
    next();
  };
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
