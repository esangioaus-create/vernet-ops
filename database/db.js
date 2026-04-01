const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'vernet_ops.db');

let _sqlJs = null;
let _db = null;

class Statement {
  constructor(dbRef, sql) { this.dbRef = dbRef; this.sql = sql; }
  _params(args) {
    if (args.length === 0) return [];
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return args;
  }
  run(...args) {
    const params = this._params(args);
    this.dbRef().run(this.sql, params);
    save();
    const r = this.dbRef().exec('SELECT last_insert_rowid() as id');
    return { lastInsertRowid: r[0]?.values[0][0] ?? 0 };
  }
  get(...args) {
    const params = this._params(args);
    const stmt = this.dbRef().prepare(this.sql);
    if (params.length) stmt.bind(params);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  all(...args) {
    const params = this._params(args);
    const stmt = this.dbRef().prepare(this.sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

class DB {
  prepare(sql) { return new Statement(() => _db, sql); }
  exec(sql) { _db.run(sql); save(); }
  pragma() {}
}

function save() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

const db = new DB();

async function init() {
  const initSqlJs = require('sql.js');
  _sqlJs = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    _db = new _sqlJs.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new _sqlJs.Database();
  }
  createTables();
  const hotelCount = db.prepare('SELECT COUNT(*) as c FROM hotels').get().c;
  if (hotelCount === 0) seedData();
  console.log('✅ Base de données initialisée');
}

function createTables() {
  _db.run(`CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    address TEXT, active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER, username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
    role TEXT NOT NULL, service TEXT, active INTEGER DEFAULT 1,
    created_by INTEGER,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL, date TEXT NOT NULL,
    content TEXT NOT NULL, created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL, title TEXT NOT NULL,
    message TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium',
    created_by INTEGER, resolved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, resolved_at DATETIME
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL, title TEXT NOT NULL,
    content TEXT NOT NULL, pinned INTEGER DEFAULT 0,
    created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL, service TEXT NOT NULL,
    user_id INTEGER, message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS deductions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL, date TEXT NOT NULL,
    client_name TEXT NOT NULL, room TEXT NOT NULL,
    amount REAL NOT NULL, opera_code TEXT, service TEXT,
    reason TEXT NOT NULL, notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by INTEGER, reviewed_by INTEGER,
    review_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS deduction_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deduction_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    uploaded_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL, date TEXT NOT NULL,
    shift TEXT NOT NULL, service TEXT NOT NULL,
    content TEXT NOT NULL, created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS maintenance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL, location TEXT NOT NULL,
    description TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    created_by INTEGER, assigned_to INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, resolved_at DATETIME
  )`);
  save();
}

function seedData() {
  const hash = (p) => bcrypt.hashSync(p, 10);
  _db.run('INSERT INTO hotels (name, slug, address) VALUES (?, ?, ?)',
    ['Hôtel Vernet', 'vernet', '25 rue Vernet, Paris 75008']);
  _db.run('INSERT INTO hotels (name, slug, address) VALUES (?, ?, ?)',
    ['Hôtel Bel Ami', 'bel-ami', '7-11 rue Saint-Benoît, Paris 75006']);

  const addUser = (hotelId, username, pw, name, role, service) =>
    _db.run('INSERT INTO users (hotel_id, username, password_hash, display_name, role, service) VALUES (?, ?, ?, ?, ?, ?)',
      [hotelId, username, hash(pw), name, role, service]);

  addUser(null, 'superadmin', 'BSignature2026!', 'Super Admin', 'super_admin', null);
  addUser(1, 'etienne', 'vernet2026', 'Etienne Sangiovanni', 'hotel_admin', null);
  addUser(1, 'alizee', 'vernet2026', 'Alizée', 'chef_service', 'housekeeping');
  addUser(1, 'julien', 'vernet2026', 'Julien', 'chef_service', 'fb');
  addUser(1, 'reception1', 'vernet2026', 'Réception', 'equipe', 'reception');
  addUser(1, 'nuit1', 'vernet2026', 'Équipe Nuit', 'equipe', 'reception');
  save();
  console.log('✅ Données de démo créées — mdp: vernet2026');
}

module.exports = { db, init };
