const express = require('express');
const { db } = require('../database/db');
const { requireAuth } = require('./auth');
const router = express.Router();

const SERVICES = ['general', 'reception', 'housekeeping', 'fb', 'maintenance', 'direction'];

router.get('/messages', requireAuth, (req, res) => {
  const { service, limit = 50 } = req.query;
  const hotelId = req.session.hotelId;

  if (service && !SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Canal invalide' });
  }

  let query = `
    SELECT m.*, u.display_name as author_name, u.service as author_service, u.role as author_role
    FROM chat_messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.hotel_id = ?
  `;
  const params = [hotelId];
  if (service) { query += ' AND m.service = ?'; params.push(service); }
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const messages = db.prepare(query).all(...params).reverse();
  res.json(messages);
});

router.get('/services', (req, res) => {
  res.json(SERVICES.map(s => ({
    id: s,
    label: {
      general: 'Général',
      reception: 'Réception',
      housekeeping: 'Housekeeping',
      fb: 'F&B',
      maintenance: 'Maintenance',
      direction: 'Direction'
    }[s] || s
  })));
});

module.exports = router;
module.exports.SERVICES = SERVICES;
