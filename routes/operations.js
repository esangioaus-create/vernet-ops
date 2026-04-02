const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');

const briefingsRouter = express.Router();
const alertsRouter = express.Router();
const announcementsRouter = express.Router();
const handoverRouter = express.Router();
const maintenanceRouter = express.Router();

// ── BRIEFINGS ─────────────────────────────────────────────────────────────────
briefingsRouter.get('/', requireAuth, (req, res) => {
  const hotelId = req.query.hotel_id || req.session.hotelId;
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.prepare(`SELECT b.*, u.display_name as author_name FROM briefings b LEFT JOIN users u ON b.created_by = u.id WHERE b.hotel_id = ? AND b.date = ? ORDER BY b.created_at DESC LIMIT 1`).get(hotelId, date) || null);
});

briefingsRouter.get('/recent', requireAuth, (req, res) => {
  const hotelId = req.session.role === 'super_admin' ? (req.query.hotel_id || req.session.hotelId) : req.session.hotelId;
  res.json(db.prepare(`SELECT b.*, u.display_name as author_name FROM briefings b LEFT JOIN users u ON b.created_by = u.id WHERE b.hotel_id = ? ORDER BY b.date DESC, b.created_at DESC LIMIT 7`).all(hotelId));
});

briefingsRouter.post('/', requireAuth, (req, res) => {
  const { content, date } = req.body;
  const hotelId = req.session.hotelId;
  const targetDate = date || new Date().toISOString().split('T')[0];
  if (!content) return res.status(400).json({ error: 'Contenu requis' });
  const existing = db.prepare('SELECT id FROM briefings WHERE hotel_id = ? AND date = ?').get(hotelId, targetDate);
  if (existing) {
    db.prepare('UPDATE briefings SET content = ?, created_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(content, req.session.userId, existing.id);
    return res.json({ id: existing.id, updated: true });
  }
  const result = db.prepare('INSERT INTO briefings (hotel_id, date, content, created_by) VALUES (?, ?, ?, ?)').run(hotelId, targetDate, content, req.session.userId);
  res.json({ id: result.lastInsertRowid, created: true });
});

// ── ALERTS ────────────────────────────────────────────────────────────────────
alertsRouter.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  let query = `SELECT a.*, u.display_name as author_name, r.display_name as resolver_name FROM alerts a LEFT JOIN users u ON a.created_by = u.id LEFT JOIN users r ON a.resolved_by = r.id WHERE a.hotel_id = ?`;
  if (req.query.active === '1') query += ' AND a.resolved_at IS NULL';
  query += ` ORDER BY CASE a.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, a.created_at DESC`;
  if (!req.query.active) query += ' LIMIT 50';
  res.json(db.prepare(query).all(hotelId));
});

alertsRouter.post('/', requireAuth, (req, res) => {
  const { title, message, priority } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Titre et message requis' });
  const result = db.prepare('INSERT INTO alerts (hotel_id, title, message, priority, created_by) VALUES (?, ?, ?, ?, ?)').run(req.session.hotelId, title, message, priority || 'medium', req.session.userId);
  const alert = db.prepare('SELECT a.*, u.display_name as author_name FROM alerts a LEFT JOIN users u ON a.created_by = u.id WHERE a.id = ?').get(result.lastInsertRowid);
  req.io.to(`hotel_${req.session.hotelId}`).emit('new_alert', alert);
  res.json(alert);
});

alertsRouter.patch('/:id/resolve', requireAuth, (req, res) => {
  db.prepare('UPDATE alerts SET resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ? AND hotel_id = ?').run(req.session.userId, req.params.id, req.session.hotelId);
  req.io.to(`hotel_${req.session.hotelId}`).emit('alert_resolved', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

alertsRouter.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM alerts WHERE id = ? AND hotel_id = ?').run(req.params.id, req.session.hotelId);
  res.json({ ok: true });
});

// ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────
announcementsRouter.get('/', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT a.*, u.display_name as author_name FROM announcements a LEFT JOIN users u ON a.created_by = u.id WHERE a.hotel_id = ? AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP) ORDER BY a.pinned DESC, a.created_at DESC LIMIT 30`).all(req.session.hotelId));
});

announcementsRouter.post('/', requireAuth, (req, res) => {
  const { title, content, pinned, expires_at } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Titre et contenu requis' });
  const result = db.prepare('INSERT INTO announcements (hotel_id, title, content, pinned, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.session.hotelId, title, content, pinned ? 1 : 0, req.session.userId, expires_at || null);
  const ann = db.prepare('SELECT a.*, u.display_name as author_name FROM announcements a LEFT JOIN users u ON a.created_by = u.id WHERE a.id = ?').get(result.lastInsertRowid);
  req.io.to(`hotel_${req.session.hotelId}`).emit('new_announcement', ann);
  res.json(ann);
});

announcementsRouter.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ? AND hotel_id = ?').run(req.params.id, req.session.hotelId);
  res.json({ ok: true });
});

// ── HANDOVERS ─────────────────────────────────────────────────────────────────

// Get by date or month
handoverRouter.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const { date, month, service } = req.query;

  let query = `
    SELECT h.*, u.display_name as author_name, u.service as author_service, u.role as author_role
    FROM handovers h LEFT JOIN users u ON h.created_by = u.id
    WHERE h.hotel_id = ?
  `;
  const params = [hotelId];

  if (date) { query += ' AND h.date = ?'; params.push(date); }
  else if (month) { query += ' AND h.date LIKE ?'; params.push(`${month}%`); }

  if (service) { query += ' AND h.service = ?'; params.push(service); }

  query += ` ORDER BY h.date ASC, CASE h.shift WHEN 'matin' THEN 1 WHEN 'apres_midi' THEN 2 ELSE 3 END`;

  res.json(db.prepare(query).all(...params));
});

// Create
handoverRouter.post('/', requireAuth, (req, res) => {
  const { content, shift, service, date } = req.body;
  if (!content || !shift) return res.status(400).json({ error: 'Contenu et shift requis' });
  const result = db.prepare('INSERT INTO handovers (hotel_id, date, shift, service, content, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
    req.session.hotelId,
    date || new Date().toISOString().split('T')[0],
    shift,
    service || req.session.service || 'general',
    content,
    req.session.userId
  );
  const ho = db.prepare('SELECT h.*, u.display_name as author_name, u.role as author_role FROM handovers h LEFT JOIN users u ON h.created_by = u.id WHERE h.id = ?').get(result.lastInsertRowid);
  req.io.to(`hotel_${req.session.hotelId}`).emit('new_handover', ho);
  res.json(ho);
});

// Update — owner always, managers always
handoverRouter.patch('/:id', requireAuth, (req, res) => {
  const { content, shift, service } = req.body;
  const ho = db.prepare('SELECT * FROM handovers WHERE id = ? AND hotel_id = ?').get(req.params.id, req.session.hotelId);
  if (!ho) return res.status(404).json({ error: 'Introuvable' });

  const canEdit = ho.created_by === req.session.userId ||
    ['hotel_admin', 'chef_service', 'super_admin'].includes(req.session.role);
  if (!canEdit) return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres consignes' });

  const updates = []; const params = [];
  if (content !== undefined) { updates.push('content = ?'); params.push(content); }
  if (shift !== undefined) { updates.push('shift = ?'); params.push(shift); }
  if (service !== undefined) { updates.push('service = ?'); params.push(service); }
  if (!updates.length) return res.status(400).json({ error: 'Rien à modifier' });
  params.push(req.params.id, req.session.hotelId);
  db.prepare(`UPDATE handovers SET ${updates.join(', ')} WHERE id = ? AND hotel_id = ?`).run(...params);

  req.io.to(`hotel_${req.session.hotelId}`).emit('handover_updated', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

// Delete — owner or manager
handoverRouter.delete('/:id', requireAuth, (req, res) => {
  const ho = db.prepare('SELECT * FROM handovers WHERE id = ? AND hotel_id = ?').get(req.params.id, req.session.hotelId);
  if (!ho) return res.status(404).json({ error: 'Introuvable' });
  const canDelete = ho.created_by === req.session.userId ||
    ['hotel_admin', 'chef_service', 'super_admin'].includes(req.session.role);
  if (!canDelete) return res.status(403).json({ error: 'Non autorisé' });
  db.prepare('DELETE FROM handovers WHERE id = ?').run(req.params.id);
  req.io.to(`hotel_${req.session.hotelId}`).emit('handover_deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ── MAINTENANCE ───────────────────────────────────────────────────────────────
maintenanceRouter.get('/', requireAuth, (req, res) => {
  let q = `SELECT m.*, c.display_name as creator_name, a.display_name as assignee_name FROM maintenance_requests m LEFT JOIN users c ON m.created_by = c.id LEFT JOIN users a ON m.assigned_to = a.id WHERE m.hotel_id = ?`;
  const params = [req.session.hotelId];
  if (req.query.status) { q += ' AND m.status = ?'; params.push(req.query.status); }
  q += ` ORDER BY CASE m.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, m.created_at DESC`;
  res.json(db.prepare(q).all(...params));
});

maintenanceRouter.post('/', requireAuth, (req, res) => {
  const { location, description, priority } = req.body;
  if (!location || !description) return res.status(400).json({ error: 'Lieu et description requis' });
  const result = db.prepare('INSERT INTO maintenance_requests (hotel_id, location, description, priority, created_by) VALUES (?, ?, ?, ?, ?)').run(req.session.hotelId, location, description, priority || 'medium', req.session.userId);
  const req_ = db.prepare('SELECT m.*, c.display_name as creator_name FROM maintenance_requests m LEFT JOIN users c ON m.created_by = c.id WHERE m.id = ?').get(result.lastInsertRowid);
  req.io.to(`hotel_${req.session.hotelId}`).emit('new_maintenance', req_);
  res.json(req_);
});

maintenanceRouter.patch('/:id', requireAuth, (req, res) => {
  const { status, assigned_to } = req.body;
  const updates = []; const params = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to); }
  if (status === 'done') updates.push('resolved_at = CURRENT_TIMESTAMP');
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.session.hotelId);
  db.prepare(`UPDATE maintenance_requests SET ${updates.join(', ')} WHERE id = ? AND hotel_id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM maintenance_requests WHERE id = ?').get(req.params.id);
  req.io.to(`hotel_${req.session.hotelId}`).emit('maintenance_updated', updated);
  res.json(updated);
});

module.exports = { briefingsRouter, alertsRouter, announcementsRouter, handoverRouter, maintenanceRouter };
