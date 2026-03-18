CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  auto_recon_mode INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scope_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('domain','wildcard','mobile','api','other')),
  value TEXT NOT NULL,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, value)
);

CREATE TABLE IF NOT EXISTS subdomains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  target_id INTEGER,
  value TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  httpx_data TEXT DEFAULT '{}',
  dirsearch_data TEXT DEFAULT '[]',
  wayback_data TEXT DEFAULT '[]',
  params_data TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 0,
  is_alive INTEGER DEFAULT 0,
  discovery_source TEXT DEFAULT '[]',
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE SET NULL,
  UNIQUE(workspace_id, value)
);

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id) REFERENCES modules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  subdomain_id INTEGER,
  method TEXT NOT NULL CHECK(method IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD')),
  path TEXT NOT NULL,
  parameters TEXT DEFAULT '[]',
  notes TEXT,
  tested INTEGER DEFAULT 0,
  FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE,
  FOREIGN KEY(subdomain_id) REFERENCES subdomains(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('Critical','High','Medium','Low')),
  target TEXT,
  module_id INTEGER,
  description TEXT,
  steps TEXT,
  impact TEXT,
  status TEXT NOT NULL DEFAULT 'Not Tested' CHECK(status IN ('Not Tested','Testing','Found','Reported','Duplicate')),
  reported INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('Critical','High','Medium','Low')),
  description TEXT,
  linked_module_id INTEGER,
  done INTEGER DEFAULT 0,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_module_id) REFERENCES modules(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  type TEXT CHECK(type IN ('domain','subdomain')) NOT NULL,
  value TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, type, value)
);

CREATE TABLE IF NOT EXISTS target_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  checklist_item_id INTEGER NOT NULL,
  status TEXT CHECK(status IN ('not_tested','testing','done','vulnerable')) DEFAULT 'not_tested',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE CASCADE,
  FOREIGN KEY(checklist_item_id) REFERENCES checklist_items(id) ON DELETE CASCADE,
  UNIQUE(target_id, checklist_item_id)
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  checklist_item_id INTEGER,
  title TEXT NOT NULL,
  severity TEXT CHECK(severity IN ('critical','high','medium','low')) NOT NULL,
  description TEXT,
  poc TEXT,
  impact TEXT,
  reported INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE CASCADE,
  FOREIGN KEY(checklist_item_id) REFERENCES checklist_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_target_checklists_target ON target_checklists(target_id);
CREATE INDEX IF NOT EXISTS idx_findings_target ON findings(target_id);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  subdomain_id INTEGER,
  tool TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending','running','completed','failed')) DEFAULT 'pending',
  output TEXT,
  output_path TEXT,
  logs TEXT,
  started_at DATETIME,
  finished_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE CASCADE,
  FOREIGN KEY(subdomain_id) REFERENCES subdomains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  status TEXT CHECK(status IN ('running','completed','failed')) NOT NULL,
  message TEXT,
  raw_output TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_results_job_id ON job_results(job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_target_id ON jobs(target_id);

CREATE TABLE IF NOT EXISTS tool_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  tool TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, tool)
);
