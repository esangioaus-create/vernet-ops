const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database/db');
const { requireAuth, requireRole } = require('./auth');
const router = express.Router();

const onlySuperAdmin = requireRole('super_admin');

// List users
router.get('/users', requireAuth, (req, res) => {
  if (!['super_admin', 'hotel_admin'].includes(req.session.role)) return res.status(403).json({ error: 'Non autorisé' });
  let users;
  if (req.session.role === 'super_admin') {
    users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.first_name, u.last_name, u.poste,
             u.role, u.service, u.active, u.hotel_id, u.must_change_password,
             h.name as hotel_name, u.last_login, u.created_at
      FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id
      ORDER BY h.name NULLS LAST, u.role, u.display_name
    `).all();
  } else {
    users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.first_name, u.last_name, u.poste,
             u.role, u.service, u.active, u.hotel_id, u.must_change_password,
             h.name as hotel_name, u.last_login, u.created_at
      FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id
      WHERE u.hotel_id = ? AND u.role != 'super_admin'
      ORDER BY u.role, u.display_name
    `).all(req.session.hotelId);
  }
  res.json(users.map(u => ({ ...u, must_change_password: u.must_change_password === 1 })));
});

// Hotels list
router.get('/hotels', requireAuth, (req, res) => {
  if (!['super_admin', 'hotel_admin'].includes(req.session.role)) return res.status(403).json({ error: 'Non autorisé' });
  res.json(db.prepare('SELECT id, name, slug FROM hotels WHERE active = 1 ORDER BY name').all());
});

// Create user — super_admin only
router.post('/users', requireAuth, onlySuperAdmin, (req, res) => {
  const { username, password, display_name, first_name, last_name, poste, role, service, hotel_id, must_change_password } = req.body;

  if (!username || !password || !display_name || !role) {
    return res.status(400).json({ error: 'Champs obligatoires : identifiant, mot de passe, nom affiché, rôle' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe minimum 8 caractères' });
  if (!['super_admin','hotel_admin','chef_service','equipe'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }
  if (role !== 'super_admin' && !hotel_id) return res.status(400).json({ error: 'Hôtel requis' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase().trim());
  if (existing) return res.status(400).json({ error: 'Identifiant déjà utilisé' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (hotel_id, username, password_hash, display_name, first_name, last_name, poste, role, service, must_change_password, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    role === 'super_admin' ? null : parseInt(hotel_id),
    username.toLowerCase().trim(),
    hash,
    display_name,
    first_name || null,
    last_name || null,
    poste || null,
    role,
    service || null,
    must_change_password ? 1 : 0,
    req.session.userId
  );

  res.json({ id: result.lastInsertRowid, ok: true });
});

// Update user — super_admin only
router.patch('/users/:id', requireAuth, onlySuperAdmin, (req, res) => {
  const { id } = req.params;
  const { display_name, first_name, last_name, poste, role, service, hotel_id, active, password, must_change_password } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const updates = []; const params = [];
  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (first_name !== undefined) { updates.push('first_name = ?'); params.push(first_name || null); }
  if (last_name !== undefined) { updates.push('last_name = ?'); params.push(last_name || null); }
  if (poste !== undefined) { updates.push('poste = ?'); params.push(poste || null); }
  if (role !== undefined) { updates.push('role = ?'); params.push(role); }
  if (service !== undefined) { updates.push('service = ?'); params.push(service || null); }
  if (hotel_id !== undefined) { updates.push('hotel_id = ?'); params.push(hotel_id || null); }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
  if (must_change_password !== undefined) { updates.push('must_change_password = ?'); params.push(must_change_password ? 1 : 0); }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe minimum 8 caractères' });
    updates.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 12));
  }

  if (!updates.length) return res.status(400).json({ error: 'Rien à modifier' });
  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// Disable user
router.delete('/users/:id', requireAuth, onlySuperAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Impossible de désactiver son propre compte' });
  }
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
