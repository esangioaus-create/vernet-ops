const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const announcements = db.prepare(`
    SELECT a.*, u.display_name as author_name
    FROM announcements a
    LEFT JOIN users u ON a.created_by = u.id
    WHERE a.hotel_id = ?
    AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
    ORDER BY a.pinned DESC, a.created_at DESC
    LIMIT 30
  `).all(hotelId);
  res.json(announcements);
});

router.post('/', requireAuth, (req, res) => {
  const { title, content, pinned, expires_at } = req.body;
  const hotelId = req.session.hotelId;
  if (!title || !content) return res.status(400).json({ error: 'Titre et contenu requis' });

  const result = db.prepare(`
    INSERT INTO announcements (hotel_id, title, content, pinned, created_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hotelId, title, content, pinned ? 1 : 0, req.session.userId, expires_at || null);

  const ann = db.prepare(`
    SELECT a.*, u.display_name as author_name
    FROM announcements a LEFT JOIN users u ON a.created_by = u.id
    WHERE a.id = ?
  `).get(result.lastInsertRowid);

  req.io.to(`hotel_${hotelId}`).emit('new_announcement', ann);
  res.json(ann);
});

router.patch('/:id', requireAuth, (req, res) => {
  const { title, content, pinned, expires_at } = req.body;
  const { id } = req.params;
  db.prepare(`
    UPDATE announcements SET title=?, content=?, pinned=?, expires_at=?
    WHERE id=? AND hotel_id=?
  `).run(title, content, pinned ? 1 : 0, expires_at || null, id, req.session.hotelId);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=? AND hotel_id=?').run(req.params.id, req.session.hotelId);
  res.json({ ok: true });
});

module.exports = router;
