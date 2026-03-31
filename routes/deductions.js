const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

// List deductions
router.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const { date, status, service } = req.query;

  let query = `
    SELECT d.*,
      c.display_name as creator_name, c.service as creator_service,
      r.display_name as reviewer_name
    FROM deductions d
    LEFT JOIN users c ON d.created_by = c.id
    LEFT JOIN users r ON d.reviewed_by = r.id
    WHERE d.hotel_id = ?
  `;
  const params = [hotelId];

  if (date) { query += ' AND d.date = ?'; params.push(date); }
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  if (service) { query += ' AND d.service = ?'; params.push(service); }

  query += ' ORDER BY d.created_at DESC';

  // Limit for non-admins to their own hotel deductions (already filtered by hotel_id)
  // Équipe can only see their own submissions
  if (req.session.role === 'equipe') {
    query += ' AND d.created_by = ?';
    params.push(req.session.userId);
  }

  res.json(db.prepare(query).all(...params));
});

// Summary for today
router.get('/summary', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const summary = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='approved' THEN amount ELSE 0 END) as total_approved_amount
    FROM deductions
    WHERE hotel_id = ? AND date = ?
  `).get(hotelId, date);

  res.json(summary);
});

// Create deduction request
router.post('/', requireAuth, (req, res) => {
  const { client_name, room, amount, opera_code, service, reason, notes, date } = req.body;
  const hotelId = req.session.hotelId;
  const targetDate = date || new Date().toISOString().split('T')[0];

  if (!client_name || !room || !amount || !reason) {
    return res.status(400).json({ error: 'Champs obligatoires : client, chambre, montant, motif' });
  }

  const result = db.prepare(`
    INSERT INTO deductions (hotel_id, date, client_name, room, amount, opera_code, service, reason, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hotelId, targetDate, client_name, room, parseFloat(amount), opera_code || null, service || null, reason, notes || null, req.session.userId);

  const ded = db.prepare(`
    SELECT d.*, c.display_name as creator_name, c.service as creator_service
    FROM deductions d LEFT JOIN users c ON d.created_by = c.id
    WHERE d.id = ?
  `).get(result.lastInsertRowid);

  // Notify managers
  req.io.to(`hotel_${hotelId}`).emit('new_deduction', ded);
  res.json(ded);
});

// Review (approve / reject)
router.patch('/:id/review', requireAuth, (req, res) => {
  const { status, review_comment } = req.body;
  const { id } = req.params;
  const hotelId = req.session.hotelId;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }
  if (!['hotel_admin', 'chef_service', 'super_admin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Non autorisé' });
  }

  db.prepare(`
    UPDATE deductions
    SET status = ?, reviewed_by = ?, review_comment = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND hotel_id = ?
  `).run(status, req.session.userId, review_comment || null, id, hotelId);

  const ded = db.prepare('SELECT * FROM deductions WHERE id = ?').get(id);
  req.io.to(`hotel_${hotelId}`).emit('deduction_reviewed', ded);
  res.json(ded);
});

router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  // Only creator or admin can delete
  const ded = db.prepare('SELECT * FROM deductions WHERE id = ? AND hotel_id = ?').get(id, req.session.hotelId);
  if (!ded) return res.status(404).json({ error: 'Introuvable' });
  if (ded.created_by !== req.session.userId && !['hotel_admin','super_admin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  if (ded.status !== 'pending') {
    return res.status(400).json({ error: 'Impossible de supprimer une déduction déjà traitée' });
  }
  db.prepare('DELETE FROM deductions WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
