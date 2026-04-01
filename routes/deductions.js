const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

// ── Storage setup ─────────────────────────────────────────────────────────────
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'deductions');
const ARCHIVE_ROOT = path.join(__dirname, '..', 'archives', 'deductions');
[UPLOAD_ROOT, ARCHIVE_ROOT].forEach(d => fs.mkdirSync(d, { recursive: true }));

// Use memory storage — write to disk manually for full control
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    // Fix encoding for filenames with accents
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté. JPG, PNG ou PDF uniquement.'));
  }
});

function getDedDir(dedId, date) {
  const month = (date || new Date().toISOString()).substring(0, 7);
  const dir = path.join(UPLOAD_ROOT, month, `ded_${dedId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getArchiveDir(dedId, date) {
  const month = (date || new Date().toISOString()).substring(0, 7);
  const dir = path.join(ARCHIVE_ROOT, month, `ded_${dedId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const { date, status, service } = req.query;
  let query = `
    SELECT d.*, c.display_name as creator_name, c.service as creator_service,
      r.display_name as reviewer_name,
      (SELECT COUNT(*) FROM deduction_attachments da WHERE da.deduction_id = d.id) as attachment_count
    FROM deductions d
    LEFT JOIN users c ON d.created_by = c.id
    LEFT JOIN users r ON d.reviewed_by = r.id
    WHERE d.hotel_id = ?
  `;
  const params = [req.session.hotelId];
  if (date) { query += ' AND d.date = ?'; params.push(date); }
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  if (service) { query += ' AND d.service = ?'; params.push(service); }
  if (req.session.role === 'equipe') { query += ' AND d.created_by = ?'; params.push(req.session.userId); }
  query += ' ORDER BY d.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/summary', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='approved' THEN amount ELSE 0 END) as total_approved_amount
    FROM deductions WHERE hotel_id = ? AND date = ?
  `).get(req.session.hotelId, date));
});

// ── CREATE ────────────────────────────────────────────────────────────────────
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

  const newId = result.lastInsertRowid;
  let ded = newId ? db.prepare(`
    SELECT d.*, c.display_name as creator_name FROM deductions d
    LEFT JOIN users c ON d.created_by = c.id WHERE d.id = ?
  `).get(newId) : null;

  if (!ded) {
    ded = db.prepare(`
      SELECT d.*, c.display_name as creator_name FROM deductions d
      LEFT JOIN users c ON d.created_by = c.id
      WHERE d.hotel_id = ? AND d.client_name = ? AND d.date = ?
      ORDER BY d.id DESC LIMIT 1
    `).get(hotelId, client_name, targetDate);
  }

  if (!ded) return res.status(500).json({ error: 'Erreur création déduction' });

  // Pre-create directory
  getDedDir(ded.id, targetDate);

  req.io.to(`hotel_${hotelId}`).emit('new_deduction', ded);
  res.json(ded);
});

// ── UPLOAD ATTACHMENTS ────────────────────────────────────────────────────────
router.post('/:id/attachments', requireAuth, upload.array('files', 20), (req, res) => {
  const { id } = req.params;
  const hotelId = req.session.hotelId;

  const ded = db.prepare('SELECT * FROM deductions WHERE id = ? AND hotel_id = ?').get(id, hotelId);
  if (!ded) return res.status(404).json({ error: 'Déduction introuvable' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Aucun fichier reçu' });

  const targetDir = getDedDir(id, ded.date);
  const saved = [];

  for (const file of req.files) {
    const unique = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const ext = path.extname(file.originalname) || (file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
    const storedName = `${unique}${ext}`;
    const destPath = path.join(targetDir, storedName);

    // Write buffer to disk
    fs.writeFileSync(destPath, file.buffer);

    const relPath = path.relative(path.join(__dirname, '..'), destPath);
    const result = db.prepare(`
      INSERT INTO deduction_attachments (deduction_id, original_filename, stored_filename, filepath, mimetype, size, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, file.originalname, storedName, relPath, file.mimetype, file.size, req.session.userId);

    saved.push({ id: result.lastInsertRowid, filename: file.originalname, size: file.size, mimetype: file.mimetype });
  }

  res.json(saved);
});

// ── LIST ATTACHMENTS ──────────────────────────────────────────────────────────
router.get('/:id/attachments', requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT id, original_filename as filename, mimetype, size, created_at
    FROM deduction_attachments WHERE deduction_id = ? ORDER BY created_at ASC
  `).all(req.params.id));
});

// ── VIEW ATTACHMENT ───────────────────────────────────────────────────────────
router.get('/attachments/:attachId', requireAuth, (req, res) => {
  const att = db.prepare('SELECT * FROM deduction_attachments WHERE id = ?').get(req.params.attachId);
  if (!att) return res.status(404).json({ error: 'Fichier introuvable' });
  const fullPath = path.join(__dirname, '..', att.filepath);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Fichier manquant sur le serveur');
  res.setHeader('Content-Type', att.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.original_filename)}"`);
  res.sendFile(fullPath);
});

// ── DELETE ATTACHMENT ─────────────────────────────────────────────────────────
router.delete('/attachments/:attachId', requireAuth, (req, res) => {
  const att = db.prepare('SELECT * FROM deduction_attachments WHERE id = ?').get(req.params.attachId);
  if (!att) return res.status(404).json({ error: 'Fichier introuvable' });
  if (!['hotel_admin','super_admin','chef_service'].includes(req.session.role) && att.uploaded_by !== req.session.userId) {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  const fullPath = path.join(__dirname, '..', att.filepath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  db.prepare('DELETE FROM deduction_attachments WHERE id = ?').run(req.params.attachId);
  res.json({ ok: true });
});

// ── REVIEW WITH SIGNATURE ─────────────────────────────────────────────────────
router.patch('/:id/review', requireAuth, (req, res) => {
  const { status, review_comment, signature } = req.body;
  const { id } = req.params;
  const hotelId = req.session.hotelId;

  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  if (!['hotel_admin','chef_service','super_admin'].includes(req.session.role)) return res.status(403).json({ error: 'Non autorisé' });
  if (!signature || signature.trim().length < 2) return res.status(400).json({ error: 'Signature requise' });

  const reviewerIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  db.prepare(`
    UPDATE deductions SET status=?, reviewed_by=?, review_comment=?, reviewer_signature=?, reviewer_ip=?, reviewed_at=CURRENT_TIMESTAMP
    WHERE id=? AND hotel_id=?
  `).run(status, req.session.userId, review_comment || null, signature.trim(), reviewerIp, id, hotelId);

  // If approved: archive files
  if (status === 'approved') {
    const ded = db.prepare('SELECT * FROM deductions WHERE id = ?').get(id);
    const atts = db.prepare('SELECT * FROM deduction_attachments WHERE deduction_id = ?').all(id);
    if (ded && atts.length > 0) {
      const archDir = getArchiveDir(id, ded.date);
      atts.forEach(att => {
        const src = path.join(__dirname, '..', att.filepath);
        const dest = path.join(archDir, att.stored_filename);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          const newRel = path.relative(path.join(__dirname, '..'), dest);
          db.prepare('UPDATE deduction_attachments SET filepath=? WHERE id=?').run(newRel, att.id);
        }
      });
      db.prepare('UPDATE deductions SET archived=1, archive_path=? WHERE id=?').run(archDir, id);
    }
  }

  const ded = db.prepare('SELECT * FROM deductions WHERE id = ?').get(id);
  req.io.to(`hotel_${hotelId}`).emit('deduction_reviewed', ded);
  res.json(ded);
});

// ── PDF EXPORT ────────────────────────────────────────────────────────────────
router.get('/:id/pdf', requireAuth, (req, res) => {
  const { id } = req.params;
  const ded = db.prepare(`
    SELECT d.*, c.display_name as creator_name, c.service as creator_service,
           r.display_name as reviewer_name, h.name as hotel_name, h.address as hotel_address
    FROM deductions d
    LEFT JOIN users c ON d.created_by = c.id
    LEFT JOIN users r ON d.reviewed_by = r.id
    LEFT JOIN hotels h ON d.hotel_id = h.id
    WHERE d.id = ? AND d.hotel_id = ?
  `).get(id, req.session.hotelId);

  if (!ded) return res.status(404).json({ error: 'Introuvable' });

  const atts = db.prepare('SELECT * FROM deduction_attachments WHERE deduction_id = ? ORDER BY created_at ASC').all(id);
  const statusLabels = { pending: 'En attente', approved: 'Approuvée ✓', rejected: 'Refusée ✗' };
  const serviceLabels = { reception: 'Réception', housekeeping: 'Housekeeping', fb: 'F&B', maintenance: 'Maintenance', direction: 'Direction' };

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const formatDateFr = (dt) => {
    if (!dt) return '—';
    return new Date(dt).toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Déduction #${String(ded.id).padStart(5,'0')} — ${ded.hotel_name}</title>
<style>
  body { font-family: Georgia, serif; margin: 40px; color: #1a1510; font-size: 13px; line-height: 1.6; }
  .header { border-bottom: 2px solid #c9a84c; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
  .hotel-name { font-size: 20px; font-weight: bold; color: #c9a84c; }
  .hotel-addr { font-size: 11px; color: #666; margin-top: 4px; }
  .doc-title { font-size: 12px; color: #888; text-align: right; text-transform: uppercase; letter-spacing: 1px; }
  .doc-id { font-size: 24px; font-weight: bold; text-align: right; margin-top: 4px; }
  .badge { display: inline-block; padding: 3px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-top: 6px; }
  .badge-approved { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
  .badge-pending { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
  .badge-rejected { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 10px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: #888; border-bottom: 1px solid #e0d8c8; padding-bottom: 6px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 12px; border: 1px solid #e0d8c8; vertical-align: top; }
  td:first-child { font-weight: bold; width: 180px; background: #faf7f2; color: #5a4e38; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .amount { font-size: 20px; font-weight: bold; color: #c9a84c; }
  .sig-box { background: #faf7f2; border: 1px solid #c9a84c; border-left: 4px solid #c9a84c; padding: 14px 18px; border-radius: 4px; margin-top: 8px; }
  .sig-name { font-size: 18px; font-style: italic; color: #1a1510; }
  .sig-meta { font-size: 11px; color: #888; margin-top: 6px; }
  .attach-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0ebe0; }
  .attach-row:last-child { border-bottom: none; }
  .attach-num { font-size: 11px; color: #888; width: 20px; flex-shrink: 0; }
  .attach-name { flex: 1; font-weight: 500; }
  .attach-size { font-size: 11px; color: #888; white-space: nowrap; }
  .attach-link { display: inline-block; padding: 3px 10px; background: #f0ebe0; border: 1px solid #c9a84c; border-radius: 3px; font-size: 11px; color: #8a6e30; text-decoration: none; font-weight: 600; white-space: nowrap; }
  .attach-link:hover { background: #c9a84c; color: #fff; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e0d8c8; font-size: 10px; color: #aaa; text-align: center; }
  @media print {
    body { margin: 20px; }
    .attach-link { border-color: #999; }
    a[href]:after { content: " (" attr(href) ")"; font-size: 9px; color: #999; }
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="hotel-name">${ded.hotel_name}</div>
    <div class="hotel-addr">${ded.hotel_address || ''}</div>
  </div>
  <div>
    <div class="doc-title">Demande de déduction</div>
    <div class="doc-id">#${String(ded.id).padStart(5, '0')}</div>
    <div style="text-align:right"><span class="badge badge-${ded.status}">${statusLabels[ded.status]}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Informations</div>
  <table>
    <tr><td>Date</td><td><strong>${ded.date}</strong></td></tr>
    <tr><td>Client</td><td><strong>${ded.client_name}</strong></td></tr>
    <tr><td>Chambre</td><td>${ded.room}</td></tr>
    <tr><td>Montant</td><td><span class="amount">− ${parseFloat(ded.amount).toFixed(2)} €</span></td></tr>
    <tr><td>Code Opera</td><td>${ded.opera_code || '—'}</td></tr>
    <tr><td>Service</td><td>${serviceLabels[ded.service] || ded.service || '—'}</td></tr>
    <tr><td>Motif</td><td>${ded.reason}</td></tr>
    ${ded.notes ? `<tr><td>Notes</td><td>${ded.notes}</td></tr>` : ''}
  </table>
</div>

<div class="section">
  <div class="section-title">Traçabilité</div>
  <table>
    <tr><td>Demandé par</td><td>${ded.creator_name || '—'}</td></tr>
    <tr><td>Soumis le</td><td>${formatDateFr(ded.created_at)}</td></tr>
    ${ded.reviewer_name ? `<tr><td>Révisé par</td><td>${ded.reviewer_name}</td></tr>` : ''}
    ${ded.reviewed_at ? `<tr><td>Révisé le</td><td>${formatDateFr(ded.reviewed_at)}</td></tr>` : ''}
    ${ded.review_comment ? `<tr><td>Commentaire</td><td>${ded.review_comment}</td></tr>` : ''}
  </table>
</div>

${ded.reviewer_signature ? `
<div class="section">
  <div class="section-title">Signature électronique</div>
  <div class="sig-box">
    <div class="sig-name">${ded.reviewer_signature}</div>
    <div class="sig-meta">
      Signé le ${formatDateFr(ded.reviewed_at)} · IP : ${ded.reviewer_ip || '—'} · Statut : ${statusLabels[ded.status]}
    </div>
  </div>
</div>` : ''}

<div class="section">
  <div class="section-title">Pièces jointes (${atts.length})</div>
  ${atts.length === 0
    ? '<p style="color:#888;font-size:12px;font-style:italic">Aucune pièce jointe</p>'
    : atts.map((a, i) => `
      <div class="attach-row">
        <span class="attach-num">${i + 1}.</span>
        <span class="attach-ico">${a.mimetype === 'application/pdf' ? '📄' : '🖼'}</span>
        <span class="attach-name">${a.original_filename}</span>
        <span class="attach-size">${(a.size / 1024).toFixed(0)} Ko</span>
        <a href="${baseUrl}/api/deductions/attachments/${a.id}" target="_blank" class="attach-link">Ouvrir le fichier →</a>
      </div>`).join('')
  }
</div>

<div class="footer">
  Vernet Ops v2.2 · Généré le ${formatDateFr(new Date().toISOString())} · Document à conserver pour archivage comptable
</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ── ZIP EXPORT ────────────────────────────────────────────────────────────────
router.get('/export/zip', requireAuth, (req, res) => {
  if (!['hotel_admin','super_admin','chef_service'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Paramètre month requis (YYYY-MM)' });
  }
  const hotelId = req.session.hotelId;
  const hotel = db.prepare('SELECT name FROM hotels WHERE id = ?').get(hotelId);
  const deds = db.prepare(`
    SELECT d.*, c.display_name as creator_name, r.display_name as reviewer_name
    FROM deductions d
    LEFT JOIN users c ON d.created_by = c.id
    LEFT JOIN users r ON d.reviewed_by = r.id
    WHERE d.hotel_id = ? AND d.date LIKE ? ORDER BY d.date, d.id
  `).all(hotelId, `${month}%`);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="deductions_${month}_${(hotel?.name||'hotel').replace(/[^a-z0-9]/gi,'_')}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  const csvLines = [
    'N°,Date,Client,Chambre,Montant,Code Opera,Service,Motif,Statut,Demandé par,Validé par,Signature,Date validation,Commentaire',
    ...deds.map(d => [
      d.id, d.date, `"${d.client_name}"`, d.room, `-${parseFloat(d.amount).toFixed(2)}`,
      d.opera_code||'', d.service||'', `"${(d.reason||'').replace(/"/g,'""')}"`,
      d.status, d.creator_name||'', d.reviewer_name||'', d.reviewer_signature||'',
      d.reviewed_at ? new Date(d.reviewed_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}) : '',
      `"${(d.review_comment||'').replace(/"/g,'""')}"`
    ].join(','))
  ];
  archive.append('\uFEFF' + csvLines.join('\n'), { name: `_recapitulatif_${month}.csv` });

  deds.forEach(ded => {
    const atts = db.prepare('SELECT * FROM deduction_attachments WHERE deduction_id = ?').all(ded.id);
    atts.forEach(att => {
      const fullPath = path.join(__dirname, '..', att.filepath);
      if (fs.existsSync(fullPath)) {
        const folder = `ded_${String(ded.id).padStart(5,'0')}_${(ded.client_name||'').replace(/[^a-z0-9]/gi,'_')}/`;
        archive.file(fullPath, { name: folder + att.original_filename });
      }
    });
  });

  archive.finalize();
});

// ── DELETE DEDUCTION ──────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  const ded = db.prepare('SELECT * FROM deductions WHERE id=? AND hotel_id=?').get(req.params.id, req.session.hotelId);
  if (!ded) return res.status(404).json({ error: 'Introuvable' });
  if (ded.created_by !== req.session.userId && !['hotel_admin','super_admin'].includes(req.session.role)) return res.status(403).json({ error: 'Non autorisé' });
  if (ded.status !== 'pending') return res.status(400).json({ error: 'Impossible de supprimer une déduction traitée' });
  const atts = db.prepare('SELECT * FROM deduction_attachments WHERE deduction_id=?').all(req.params.id);
  atts.forEach(att => { const p = path.join(__dirname, '..', att.filepath); if (fs.existsSync(p)) fs.unlinkSync(p); });
  db.prepare('DELETE FROM deduction_attachments WHERE deduction_id=?').run(req.params.id);
  db.prepare('DELETE FROM deductions WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
