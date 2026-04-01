// Fix 1: deductions route - robust id retrieval
// Fix 2: return id directly after insert

const express = require('express');
const multer = require('multer');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté. JPG, PNG ou PDF uniquement.'));
  }
});

router.get('/', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const { date, status, service } = req.query;
  let query = `
    SELECT d.*,
      c.display_name as creator_name, c.service as creator_service,
      r.display_name as reviewer_name,
      (SELECT COUNT(*) FROM deduction_attachments da WHERE da.deduction_id = d.id) as attachment_count
    FROM deductions d
    LEFT JOIN users c ON d.created_by = c.id
    LEFT JOIN users r ON d.reviewed_by = r.id
    WHERE d.hotel_id = ?
  `;
  const params = [hotelId];
  if (date) { query += ' AND d.date = ?'; params.push(date); }
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  if (service) { query += ' AND d.service = ?'; params.push(service); }
  if (req.session.role === 'equipe') { query += ' AND d.created_by = ?'; params.push(req.session.userId); }
  query += ' ORDER BY d.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/summary', requireAuth, (req, res) => {
  const hotelId = req.session.hotelId;
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='approved' THEN amount ELSE 0 END) as total_approved_amount
    FROM deductions WHERE hotel_id = ? AND date = ?
  `).get(hotelId, date));
});

router.post('/', requireAuth, (req, res) => {
  const { client_name, room, amount, opera_code, service, reason, notes, date } = req.body;
  const hotelId = req.session.hotelId;
  const targetDate = date || new Date().toISOString().split('T')[0];
  if (!client_name || !room || !amount || !reason) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  const result = db.prepare(`
    INSERT INTO deductions (hotel_id, date, client_name, room, amount, opera_code, service, reason, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hotelId, targetDate, client_name, room, parseFloat(amount), opera_code || null, service || null, reason, notes || null, req.session.userId);

  // Use lastInsertRowid directly, fetch with fallback
  const newId = result.lastInsertRowid;
  let ded = null;
  
  if (newId) {
    ded = db.prepare(`
      SELECT d.*, c.display_name as creator_name, c.service as creator_service
      FROM deductions d LEFT JOIN users c ON d.created_by = c.id WHERE d.id = ?
    `).get(newId);
  }
  
  // Fallback: get most recent deduction for this hotel/date/client if id lookup fails
  if (!ded) {
    ded = db.prepare(`
      SELECT d.*, c.display_name as creator_name, c.service as creator_service
      FROM deductions d LEFT JOIN users c ON d.created_by = c.id
      WHERE d.hotel_id = ? AND d.client_name = ? AND d.date = ?
      ORDER BY d.id DESC LIMIT 1
    `).get(hotelId, client_name, targetDate);
  }

  if (!ded) return res.status(500).json({ error: 'Erreur création déduction' });

  req.io.to(`hotel_${hotelId}`).emit('new_deduction', ded);
  res.json(ded);
});

router.post('/:id/attachments', requireAuth, upload.single('file'), (req, res) => {
  const { id } = req.params;
  const hotelId = req.session.hotelId;
  const ded = db.prepare('SELECT * FROM deductions WHERE id = ? AND hotel_id = ?').get(id, hotelId);
  if (!ded) return res.status(404).json({ error: 'Déduction introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  const result = db.prepare(`
    INSERT INTO deduction_attachments (deduction_id, filename, mimetype, size, data, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.session.userId);
  res.json({ id: result.lastInsertRowid, filename: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size });
});

router.get('/:id/attachments', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, filename, mimetype, size, created_at FROM deduction_attachments WHERE deduction_id = ?').all(req.params.id));
});

router.get('/attachments/:attachId', requireAuth, (req, res) => {
  const att = db.prepare('SELECT * FROM deduction_attachments WHERE id = ?').get(req.params.attachId);
  if (!att) return res.status(404).json({ error: 'Fichier introuvable' });
  res.setHeader('Content-Type', att.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${att.filename}"`);
  res.send(Buffer.from(att.data));
});

router.delete('/attachments/:attachId', requireAuth, (req, res) => {
  const att = db.prepare('SELECT * FROM deduction_attachments WHERE id = ?').get(req.params.attachId);
  if (!att) return res.status(404).json({ error: 'Fichier introuvable' });
  if (!['hotel_admin','super_admin','chef_service'].includes(req.session.role) && att.uploaded_by !== req.session.userId) {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  db.prepare('DELETE FROM deduction_attachments WHERE id = ?').run(req.params.attachId);
  res.json({ ok: true });
});

router.patch('/:id/review', requireAuth, (req, res) => {
  const { status, review_comment } = req.body;
  const { id } = req.params;
  const hotelId = req.session.hotelId;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  if (!['hotel_admin','chef_service','super_admin'].includes(req.session.role)) return res.status(403).json({ error: 'Non autorisé' });
  db.prepare('UPDATE deductions SET status=?, reviewed_by=?, review_comment=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND hotel_id=?')
    .run(status, req.session.userId, review_comment||null, id, hotelId);
  const ded = db.prepare('SELECT * FROM deductions WHERE id = ?').get(id);
  req.io.to(`hotel_${hotelId}`).emit('deduction_reviewed', ded);
  res.json(ded);
});

router.delete('/:id', requireAuth, (req, res) => {
  const ded = db.prepare('SELECT * FROM deductions WHERE id=? AND hotel_id=?').get(req.params.id, req.session.hotelId);
  if (!ded) return res.status(404).json({ error: 'Introuvable' });
  if (ded.created_by !== req.session.userId && !['hotel_admin','super_admin'].includes(req.session.role)) return res.status(403).json({ error: 'Non autorisé' });
  if (ded.status !== 'pending') return res.status(400).json({ error: 'Impossible de supprimer une déduction traitée' });
  db.prepare('DELETE FROM deduction_attachments WHERE deduction_id=?').run(req.params.id);
  db.prepare('DELETE FROM deductions WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
