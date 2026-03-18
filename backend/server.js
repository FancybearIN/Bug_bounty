const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { initDb } = require('./db/init');
const { startJobWorker } = require('./jobs/worker');

// Initialize DB
initDb();

const app = express();
const PORT = 9000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// API Routes
app.use('/api/workspaces', require('./routes/workspaces'));
app.use('/api/scope', require('./routes/scope'));
app.use('/api/subdomains', require('./routes/subdomains'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/bugs', require('./routes/bugs'));
app.use('/api/checklist', require('./routes/checklist'));
app.use('/api/target-checklist', require('./routes/targetChecklist'));
app.use('/api/findings', require('./routes/findings'));
app.use('/api/targets', require('./routes/targets'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/recon', require('./routes/recon'));
app.use('/api/recon', require('./routes/reconPipeline'));
app.use('/api/tools', require('./routes/tools'));
app.use('/api/coverage', require('./routes/coverage'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Export workspace (full JSON dump)
app.get('/api/export/:workspace_id', (req, res) => {
  const { getDb } = require('./db/init');
  const db = getDb();
  const wsId = req.params.workspace_id;
  try {
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id=?').get(wsId);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const scope = db.prepare('SELECT * FROM scope_entries WHERE workspace_id=?').all(wsId);
    const subdomains = db.prepare('SELECT * FROM subdomains WHERE workspace_id=?').all(wsId);
    const modules = db.prepare('SELECT * FROM modules WHERE workspace_id=?').all(wsId);
    const moduleIds = modules.map(m => m.id);
    const endpoints = moduleIds.length
      ? db.prepare(`SELECT * FROM endpoints WHERE module_id IN (${moduleIds.map(() => '?').join(',')})`).all(...moduleIds)
      : [];
    const bugs = db.prepare('SELECT * FROM bugs WHERE workspace_id=?').all(wsId);
    const checklist = db.prepare('SELECT * FROM checklist_items WHERE workspace_id=?').all(wsId);

    res.setHeader('Content-Disposition', `attachment; filename="${workspace.name}-export.json"`);
    res.json({ workspace, scope, subdomains, modules, endpoints, bugs, checklist, exported_at: new Date().toISOString() });
  } finally {
    db.close();
  }
});

// Import workspace
app.post('/api/import', express.json({ limit: '100mb' }), (req, res) => {
  const data = req.body;
  if (!data.workspace) return res.status(400).json({ error: 'Invalid import file' });
  const { getDb } = require('./db/init');
  const db = getDb();
  try {
    const r = db.prepare('INSERT OR IGNORE INTO workspaces (name, description, created_at) VALUES (?,?,?)').run(
      data.workspace.name + ' (imported)', data.workspace.description, data.workspace.created_at
    );
    const newWsId = r.lastInsertRowid;
    if (!newWsId) return res.status(409).json({ error: 'Workspace name conflict' });

    for (const s of (data.scope || [])) db.prepare('INSERT OR IGNORE INTO scope_entries (workspace_id,type,value,notes) VALUES (?,?,?,?)').run(newWsId, s.type, s.value, s.notes);
    for (const s of (data.subdomains || [])) db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id,value,httpx_data,dirsearch_data,wayback_data,params_data,tags) VALUES (?,?,?,?,?,?,?)').run(newWsId, s.value, s.httpx_data, s.dirsearch_data, s.wayback_data, s.params_data, s.tags);
    for (const m of (data.modules || [])) db.prepare('INSERT INTO modules (workspace_id,name,parent_id) VALUES (?,?,?)').run(newWsId, m.name, null); // simplified
    for (const b of (data.bugs || [])) db.prepare('INSERT INTO bugs (workspace_id,title,severity,target,description,steps,impact,status,reported) VALUES (?,?,?,?,?,?,?,?,?)').run(newWsId, b.title, b.severity, b.target, b.description, b.steps, b.impact, b.status, b.reported);
    for (const c of (data.checklist || [])) db.prepare('INSERT INTO checklist_items (workspace_id,category,title,severity,description,done) VALUES (?,?,?,?,?,?)').run(newWsId, c.category, c.title, c.severity, c.description, c.done);

    res.json({ success: true, workspace_id: newWsId });
  } finally {
    db.close();
  }
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

startJobWorker();

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Bug Bounty Recon Intelligence System        ║`);
  console.log(`║  Running at: http://localhost:${PORT}          ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});

module.exports = app;
