const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

// Get briefing for a date (default today)
router.get('/', requireAuth, (req, res) => {
  const hotelId = req.query.hotel_id || req.session.hotelId;
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const briefing = db.prepare(`
    SELECT b.*, u.display_name as author_name
    FROM briefings b
    LEFT JOIN users u ON b.created_by = u.id
    WHERE b.hotel_id = ? AND b.date = ?
    ORDER BY b.created_at DESC LIMIT 1
  `).get(hotelId, date);

  res.json(briefing || null);
});

// Get recent briefings
router.get('/recent', requireAuth, (req, res) => {
  const hotelId = req.session.role === 'super_admin'
    ? (req.query.hotel_id || req.session.hotelId)
    : req.session.hotelId;
  const limit = parseInt(req.query.limit) || 7;

  const briefings = db.prepare(`
    SELECT b.*, u.display_name as author_name
    FROM briefings b
    LEFT JOIN users u ON b.created_by = u.id
    WHERE b.hotel_id = ?
    ORDER BY b.date DESC, b.created_at DESC
    LIMIT ?
  `).all(hotelId, limit);

  res.json(briefings);
});

// Create or update briefing
router.post('/', requireAuth, (req, res) => {
  const { content, date } = req.body;
  const hotelId = req.session.hotelId;
  const targetDate = date || new Date().toISOString().split('T')[0];

  if (!content) return res.status(400).json({ error: 'Contenu requis' });

  const existing = db.prepare('SELECT id FROM briefings WHERE hotel_id = ? AND date = ?').get(hotelId, targetDate);

  if (existing) {
    db.prepare('UPDATE briefings SET content = ?, created_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(content, req.session.userId, existing.id);
    return res.json({ id: existing.id, updated: true });
  }

  const result = db.prepare('INSERT INTO briefings (hotel_id, date, content, created_by) VALUES (?, ?, ?, ?)')
    .run(hotelId, targetDate, content, req.session.userId);

  res.json({ id: result.lastInsertRowid, created: true });
});

module.exports = router;
