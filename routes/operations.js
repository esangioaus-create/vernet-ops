const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');

const handoverRouter = express.Router();
const maintenanceRouter = express.Router();

// ── PASSATIONS ────────────────────────────────────────────────────────────────

handoverRouter.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const service = req.query.service;

  let q = `
    SELECT h.*, u.display_name as author_name, u.service as author_service
    FROM handovers h LEFT JOIN users u ON h.created_by = u.id
    WHERE h.hotel_id = ? AND h.date = ?
  `;
  const params = [hotelId, date];
  if (service) { q += ' AND h.service = ?'; params.push(service); }
  q += ' ORDER BY CASE h.shift WHEN \'matin\' THEN 1 WHEN \'apres_midi\' THEN 2 ELSE 3 END';

  res.json(db.prepare(q).all(...params));
});

handoverRouter.post('/', requireAuth, (req, res) => {
  const { content, shift, service, date } = req.body;
  const hotelId = req.session.hotelId;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const targetService = service || req.session.service || 'general';

  if (!content || !shift) return res.status(400).json({ error: 'Contenu et shift requis' });

  const result = db.prepare(`
    INSERT INTO handovers (hotel_id, date, shift, service, content, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hotelId, targetDate, shift, targetService, content, req.session.userId);

  res.json({ id: result.lastInsertRowid, ok: true });
});

// ── MAINTENANCE ───────────────────────────────────────────────────────────────

maintenanceRouter.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const { status } = req.query;

  let q = `
    SELECT m.*, c.display_name as creator_name, a.display_name as assignee_name
    FROM maintenance_requests m
    LEFT JOIN users c ON m.created_by = c.id
    LEFT JOIN users a ON m.assigned_to = a.id
    WHERE m.hotel_id = ?
  `;
  const params = [hotelId];
  if (status) { q += ' AND m.status = ?'; params.push(status); }
  q += ' ORDER BY CASE m.priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END, m.created_at DESC';

  res.json(db.prepare(q).all(...params));
});

maintenanceRouter.post('/', requireAuth, (req, res) => {
  const { location, description, priority } = req.body;
  const hotelId = req.session.hotelId;

  if (!location || !description) return res.status(400).json({ error: 'Lieu et description requis' });

  const result = db.prepare(`
    INSERT INTO maintenance_requests (hotel_id, location, description, priority, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(hotelId, location, description, priority || 'medium', req.session.userId);

  const req_ = db.prepare(`
    SELECT m.*, c.display_name as creator_name
    FROM maintenance_requests m LEFT JOIN users c ON m.created_by = c.id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);

  req.io.to(`hotel_${hotelId}`).emit('new_maintenance', req_);
  res.json(req_);
});

maintenanceRouter.patch('/:id', requireAuth, (req, res) => {
  const { status, assigned_to } = req.body;
  const { id } = req.params;
  const hotelId = req.session.hotelId;

  const updates = [];
  const params = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to); }
  if (status === 'done') { updates.push('resolved_at = CURRENT_TIMESTAMP'); }
  updates.push('updated_at = CURRENT_TIMESTAMP');

  if (updates.length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });

  params.push(id, hotelId);
  db.prepare(`UPDATE maintenance_requests SET ${updates.join(', ')} WHERE id = ? AND hotel_id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM maintenance_requests WHERE id = ?').get(id);
  req.io.to(`hotel_${hotelId}`).emit('maintenance_updated', updated);
  res.json(updated);
});

module.exports = { handoverRouter, maintenanceRouter };
