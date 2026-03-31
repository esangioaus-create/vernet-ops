const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const active = req.query.active;

  let query = `
    SELECT a.*, u.display_name as author_name, r.display_name as resolver_name
    FROM alerts a
    LEFT JOIN users u ON a.created_by = u.id
    LEFT JOIN users r ON a.resolved_by = r.id
    WHERE a.hotel_id = ?
  `;
  if (active === '1') query += ' AND a.resolved_at IS NULL';
  query += ' ORDER BY CASE a.priority WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END, a.created_at DESC';
  if (!active) query += ' LIMIT 50';

  res.json(db.prepare(query).all(hotelId));
});

router.post('/', requireAuth, (req, res) => {
  const { title, message, priority } = req.body;
  const hotelId = req.session.hotelId;

  if (!title || !message) return res.status(400).json({ error: 'Titre et message requis' });

  const result = db.prepare(`
    INSERT INTO alerts (hotel_id, title, message, priority, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(hotelId, title, message, priority || 'medium', req.session.userId);

  const alert = db.prepare(`
    SELECT a.*, u.display_name as author_name
    FROM alerts a LEFT JOIN users u ON a.created_by = u.id
    WHERE a.id = ?
  `).get(result.lastInsertRowid);

  req.io.to(`hotel_${hotelId}`).emit('new_alert', alert);
  res.json(alert);
});

router.patch('/:id/resolve', requireAuth, (req, res) => {
  const { id } = req.params;
  const hotelId = req.session.hotelId;

  db.prepare(`
    UPDATE alerts SET resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
    WHERE id = ? AND hotel_id = ?
  `).run(req.session.userId, id, hotelId);

  req.io.to(`hotel_${hotelId}`).emit('alert_resolved', { id: parseInt(id) });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM alerts WHERE id = ? AND hotel_id = ?').run(id, req.session.hotelId);
  res.json({ ok: true });
});

module.exports = router;
