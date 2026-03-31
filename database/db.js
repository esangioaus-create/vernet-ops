const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'vernet_ops.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hotels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      address TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER REFERENCES hotels(id),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin','hotel_admin','chef_service','equipe')),
      service TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id),
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('low','medium','high','critical')) DEFAULT 'medium',
      created_by INTEGER REFERENCES users(id),
      resolved_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id),
      service TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id),
      date TEXT NOT NULL,
      client_name TEXT NOT NULL,
      room TEXT NOT NULL,
      amount REAL NOT NULL,
      opera_code TEXT,
      service TEXT,
      reason TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
      created_by INTEGER REFERENCES users(id),
      reviewed_by INTEGER REFERENCES users(id),
      review_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS handovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id),
      date TEXT NOT NULL,
      shift TEXT NOT NULL CHECK(shift IN ('matin','apres_midi','nuit')),
      service TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id),
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('low','medium','high','urgent')) DEFAULT 'medium',
      status TEXT NOT NULL CHECK(status IN ('open','in_progress','done')) DEFAULT 'open',
      created_by INTEGER REFERENCES users(id),
      assigned_to INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );
  `);

  // Seed initial data if no hotels exist
  const hotelCount = db.prepare('SELECT COUNT(*) as c FROM hotels').get().c;
  if (hotelCount === 0) {
    seedData();
  }
}

function seedData() {
  // Hotels
  const insertHotel = db.prepare('INSERT INTO hotels (name, slug, address) VALUES (?, ?, ?)');
  const vernet = insertHotel.run('Hôtel Vernet', 'vernet', '25 rue Vernet, Paris 75008');
  insertHotel.run('Hôtel Bel Ami', 'bel-ami', '7-11 rue Saint-Benoît, Paris 75006');

  // Users
  const insertUser = db.prepare(`
    INSERT INTO users (hotel_id, username, password_hash, display_name, role, service)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const hash = (p) => bcrypt.hashSync(p, 10);

  // Super Admin (no hotel)
  insertUser.run(null, 'superadmin', hash('BSignature2026!'), 'Super Admin', 'super_admin', null);

  // Hôtel Vernet
  insertUser.run(vernet.lastInsertRowid, 'etienne', hash('vernet2026'), 'Etienne Sangiovanni', 'hotel_admin', null);
  insertUser.run(vernet.lastInsertRowid, 'alizee', hash('vernet2026'), 'Alizée', 'chef_service', 'housekeeping');
  insertUser.run(vernet.lastInsertRowid, 'julien', hash('vernet2026'), 'Julien', 'chef_service', 'fb');
  insertUser.run(vernet.lastInsertRowid, 'reception1', hash('vernet2026'), 'Réception', 'equipe', 'reception');
  insertUser.run(vernet.lastInsertRowid, 'nuit1', hash('vernet2026'), 'Équipe Nuit', 'equipe', 'reception');

  console.log('✅ Base de données initialisée avec les données de démo');
  console.log('   Comptes : etienne / alizee / julien / reception1 (mdp: vernet2026)');
  console.log('   Super Admin : superadmin / BSignature2026!');
}

module.exports = { db, init };
