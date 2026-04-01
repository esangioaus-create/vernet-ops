const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database/db');
const { requireAuth, requireRole } = require('./auth');
const router = express.Router();

const onlySuperAdmin = requireRole('super_admin');

// List all users (super_admin: all hotels, hotel_admin: own hotel)
router.get('/users', requireAuth, (req, res) => {
  const { role, hotelId } = req.session;
  let users;
  if (role === 'super_admin') {
    users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.service, u.active,
             u.hotel_id, h.name as hotel_name, u.last_login, u.created_at
      FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id
      ORDER BY h.name, u.role, u.display_name
    `).all();
  } else if (role === 'hotel_admin') {
    users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.service, u.active,
             u.hotel_id, h.name as hotel_name, u.last_login, u.created_at
      FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id
      WHERE u.hotel_id = ? AND u.role != 'super_admin'
      ORDER BY u.role, u.display_name
    `).all(hotelId);
  } else {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  res.json(users);
});

// Get hotels list
router.get('/hotels', requireAuth, (req, res) => {
  if (!['super_admin', 'hotel_admin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  res.json(db.prepare('SELECT id, name, slug FROM hotels WHERE active = 1 ORDER BY name').all());
});

// Create user — super_admin only
router.post('/users', requireAuth, onlySuperAdmin, (req, res) => {
  const { username, password, display_name, role, service, hotel_id } = req.body;

  if (!username || !password || !display_name || !role) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe minimum 8 caractères' });
  }
  const validRoles = ['super_admin', 'hotel_admin', 'chef_service', 'equipe'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }
  if (role !== 'super_admin' && !hotel_id) {
    return res.status(400).json({ error: 'Hôtel requis pour ce rôle' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase().trim());
  if (existing) return res.status(400).json({ error: 'Identifiant déjà utilisé' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (hotel_id, username, password_hash, display_name, role, service, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    role === 'super_admin' ? null : parseInt(hotel_id),
    username.toLowerCase().trim(),
    hash, display_name, role,
    service || null,
    req.session.userId
  );

  res.json({ id: result.lastInsertRowid, ok: true });
});

// Update user
router.patch('/users/:id', requireAuth, onlySuperAdmin, (req, res) => {
  const { id } = req.params;
  const { display_name, role, service, hotel_id, active, password } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const updates = [];
  const params = [];

  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (role !== undefined) { updates.push('role = ?'); params.push(role); }
  if (service !== undefined) { updates.push('service = ?'); params.push(service || null); }
  if (hotel_id !== undefined) { updates.push('hotel_id = ?'); params.push(hotel_id || null); }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe minimum 8 caractères' });
    updates.push('password_hash = ?');
    params.push(bcrypt.hashSync(password, 12));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// Delete user (disable)
router.delete('/users/:id', requireAuth, onlySuperAdmin, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.session.userId) {
    return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });
  }
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
