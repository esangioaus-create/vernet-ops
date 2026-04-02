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
    const r = this.dbRef().exec('SELECT last_insert_rowid()');
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
  migrateIfNeeded();
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
    hotel_id INTEGER,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    poste TEXT,
    role TEXT NOT NULL,
    service TEXT,
    active INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0,
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
    review_comment TEXT, reviewer_signature TEXT, reviewer_ip TEXT,
    archived INTEGER DEFAULT 0, archive_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS deduction_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deduction_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL, stored_filename TEXT NOT NULL,
    filepath TEXT NOT NULL, mimetype TEXT NOT NULL, size INTEGER NOT NULL,
    uploaded_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Add new columns to existing DB without breaking it
function migrateIfNeeded() {
  const cols = _db.exec("PRAGMA table_info(users)")[0]?.values?.map(r => r[1]) || [];
  if (!cols.includes('first_name')) _db.run("ALTER TABLE users ADD COLUMN first_name TEXT");
  if (!cols.includes('last_name')) _db.run("ALTER TABLE users ADD COLUMN last_name TEXT");
  if (!cols.includes('poste')) _db.run("ALTER TABLE users ADD COLUMN poste TEXT");
  if (!cols.includes('must_change_password')) _db.run("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0");
  save();
}

function seedData() {
  const hash = (p) => bcrypt.hashSync(p, 10);

  _db.run('INSERT INTO hotels (name, slug, address) VALUES (?, ?, ?)',
    ['Hôtel Vernet', 'vernet', '25 rue Vernet, Paris 75008']);
  _db.run('INSERT INTO hotels (name, slug, address) VALUES (?, ?, ?)',
    ['Hôtel Bel Ami', 'bel-ami', '7-11 rue Saint-Benoît, Paris 75006']);

  const addUser = (hotelId, username, pw, displayName, firstName, lastName, poste, role, service, mustChange = 0) =>
    _db.run(`INSERT INTO users (hotel_id, username, password_hash, display_name, first_name, last_name, poste, role, service, must_change_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hotelId, username, hash(pw), displayName, firstName, lastName, poste, role, service, mustChange]);

  // ── SUPER ADMIN ───────────────────────────────────────────────────────────
  addUser(null, 'etienne', 'vernet2026', 'Etienne Sangiovanni',
    'Etienne', 'Sangiovanni', 'Directeur des Opérations', 'super_admin', null, 0);

  // ── HÔTEL VERNET ─────────────────────────────────────────────────────────
  addUser(1, 'alizee', 'vernet2026', 'Alizée',
    'Alizée', '', 'Gouvernante', 'chef_service', 'housekeeping', 0);
  addUser(1, 'julien', 'vernet2026', 'Julien',
    'Julien', '', 'Responsable F&B', 'chef_service', 'fb', 0);
  addUser(1, 'reception1', 'vernet2026', 'Réception',
    'Réceptionniste', '', 'Réceptionniste', 'equipe', 'reception', 0);
  addUser(1, 'nuit1', 'vernet2026', 'Équipe Nuit',
    'Veilleur', 'de Nuit', 'Veilleur de nuit', 'equipe', 'reception', 0);

  save();
  console.log('✅ Données de démo créées');
  console.log('   etienne / vernet2026 → Super Admin');
  console.log('   alizee / julien / reception1 / nuit1 → vernet2026');
}

module.exports = { db, init };
