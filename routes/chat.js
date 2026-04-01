const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

const SERVICES = ['general', 'reception', 'housekeeping', 'fb', 'maintenance', 'direction'];

// Visibility: equipe only sees their own service channel + general
// chef_service, hotel_admin, super_admin see all
function getAllowedServices(session) {
  if (session.role === 'equipe') {
    const svc = session.service || 'general';
    return ['general', svc].filter((v, i, a) => a.indexOf(v) === i);
  }
  return SERVICES;
}

router.get('/messages', requireAuth, (req, res) => {
  const { service, limit = 60 } = req.query;
  const hotelId = req.session.hotelId;
  const allowed = getAllowedServices(req.session);

  if (service && !allowed.includes(service)) {
    return res.status(403).json({ error: 'Accès non autorisé à ce canal' });
  }

  let query = `
    SELECT m.*, u.display_name as author_name, u.service as author_service, u.role as author_role
    FROM chat_messages m LEFT JOIN users u ON m.user_id = u.id
    WHERE m.hotel_id = ?
  `;
  const params = [hotelId];
  if (service) { query += ' AND m.service = ?'; params.push(service); }
  else {
    // Only return messages from allowed services
    const placeholders = allowed.map(() => '?').join(',');
    query += ` AND m.service IN (${placeholders})`;
    params.push(...allowed);
  }
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  res.json(db.prepare(query).all(...params).reverse());
});

router.get('/services', requireAuth, (req, res) => {
  const allowed = getAllowedServices(req.session);
  const labels = {
    general: 'Général', reception: 'Réception', housekeeping: 'Housekeeping',
    fb: 'F&B', maintenance: 'Maintenance', direction: 'Direction'
  };
  res.json(allowed.map(s => ({ id: s, label: labels[s] || s })));
});

module.exports = router;
module.exports.SERVICES = SERVICES;
module.exports.getAllowedServices = getAllowedServices;
