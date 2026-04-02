// Exécute ce script UNE SEULE FOIS pour upgrader le compte etienne en super_admin
// Dans cmd : node upgrade-etienne.js

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Try both possible DB paths
const paths = [
  path.join(__dirname, 'database', 'vernet_ops.db'),
  path.join(__dirname, 'vernet_ops.db'),
];

// For sql.js based setup
async function upgradeSqlJs() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  
  const dbPath = paths.find(p => fs.existsSync(p));
  if (!dbPath) { console.error('❌ Base de données introuvable'); process.exit(1); }
  
  const db = new SQL.Database(fs.readFileSync(dbPath));
  
  const user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').getAsObject(['etienne']);
  if (!user.id) { console.error('❌ Compte etienne introuvable'); process.exit(1); }
  
  console.log(`Compte trouvé : ${user.username} — rôle actuel : ${user.role}`);
  
  db.run('UPDATE users SET role = ?, hotel_id = NULL WHERE username = ?', ['super_admin', 'etienne']);
  
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  
  console.log('✅ Compte etienne mis à jour → super_admin');
  console.log('✅ Reconnectez-vous avec vos identifiants habituels');
}

upgradeSqlJs().catch(console.error);
