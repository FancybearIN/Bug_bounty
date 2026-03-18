const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'recon.db');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function hasColumn(db, tableName, columnName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((c) => c.name === columnName);
}

function normalizeHostLikeValue(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

function resolveTargetId(targetRows, value) {
  const host = normalizeHostLikeValue(value);
  if (!host?.includes('.')) return null;

  let best = null;
  for (const row of targetRows) {
    const domain = normalizeHostLikeValue(row.value);
    if (!domain) continue;
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (!best || domain.length > best.domain.length) {
      best = { id: row.id, domain };
    }
  }

  return best ? best.id : null;
}

function runMigrations(db) {
  if (!hasColumn(db, 'workspaces', 'auto_recon_mode')) {
    db.exec('ALTER TABLE workspaces ADD COLUMN auto_recon_mode INTEGER DEFAULT 0');
  }

  if (!hasColumn(db, 'targets', 'is_active')) {
    db.exec('ALTER TABLE targets ADD COLUMN is_active INTEGER DEFAULT 0');
  }

  if (!hasColumn(db, 'subdomains', 'target_id')) {
    db.exec('ALTER TABLE subdomains ADD COLUMN target_id INTEGER');
  }

  if (!hasColumn(db, 'endpoints', 'subdomain_id')) {
    db.exec('ALTER TABLE endpoints ADD COLUMN subdomain_id INTEGER');
  }

  if (!hasColumn(db, 'scope_entries', 'is_active')) {
    db.exec('ALTER TABLE scope_entries ADD COLUMN is_active INTEGER DEFAULT 1');
  }

  if (!hasColumn(db, 'subdomains', 'is_active')) {
    db.exec('ALTER TABLE subdomains ADD COLUMN is_active INTEGER DEFAULT 0');
  }

  if (!hasColumn(db, 'subdomains', 'is_alive')) {
    db.exec('ALTER TABLE subdomains ADD COLUMN is_alive INTEGER DEFAULT 0');
  }

  if (!hasColumn(db, 'subdomains', 'discovery_source')) {
    db.exec('ALTER TABLE subdomains ADD COLUMN discovery_source TEXT DEFAULT \'[]\'');
  }

  if (!hasColumn(db, 'jobs', 'subdomain_id')) {
    db.exec('ALTER TABLE jobs ADD COLUMN subdomain_id INTEGER');
  }

  if (!hasColumn(db, 'jobs', 'output_path')) {
    db.exec('ALTER TABLE jobs ADD COLUMN output_path TEXT');
  }

  if (!hasColumn(db, 'jobs', 'logs')) {
    db.exec('ALTER TABLE jobs ADD COLUMN logs TEXT');
  }

  if (!hasColumn(db, 'jobs', 'started_at')) {
    db.exec('ALTER TABLE jobs ADD COLUMN started_at DATETIME');
  }

  if (!hasColumn(db, 'jobs', 'finished_at')) {
    db.exec('ALTER TABLE jobs ADD COLUMN finished_at DATETIME');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS job_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      status TEXT CHECK(status IN ('running','completed','failed')) NOT NULL,
      message TEXT,
      raw_output TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      tool TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      UNIQUE(workspace_id, tool)
    )
  `);

  db.exec('DELETE FROM scope_entries WHERE id NOT IN (SELECT MIN(id) FROM scope_entries GROUP BY workspace_id, value)');
  db.exec('DELETE FROM subdomains WHERE id NOT IN (SELECT MIN(id) FROM subdomains GROUP BY workspace_id, value)');

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_scope_workspace_value_unique ON scope_entries(workspace_id, value)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_subdomains_target_id ON subdomains(target_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_endpoints_subdomain_id ON endpoints(subdomain_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_job_results_job_id ON job_results(job_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_target_id ON jobs(target_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_subdomain_id ON jobs(subdomain_id)');

  const targetsByWorkspace = new Map();
  const targets = db.prepare("SELECT id, workspace_id, value FROM targets WHERE type='domain'").all();
  for (const t of targets) {
    if (!targetsByWorkspace.has(t.workspace_id)) targetsByWorkspace.set(t.workspace_id, []);
    targetsByWorkspace.get(t.workspace_id).push(t);
  }

  const subdomains = db.prepare('SELECT id, workspace_id, value, target_id FROM subdomains').all();
  const updateTarget = db.prepare('UPDATE subdomains SET target_id = ? WHERE id = ?');
  for (const sd of subdomains) {
    if (sd.target_id) continue;
    const targetRows = targetsByWorkspace.get(sd.workspace_id) || [];
    const targetId = resolveTargetId(targetRows, sd.value);
    if (targetId) updateTarget.run(targetId, sd.id);
  }
}

function initDb() {
  const db = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  runMigrations(db);
  db.close();
  console.log('[DB] Initialized successfully at', DB_PATH);
}

module.exports = { getDb, initDb, DB_PATH };
