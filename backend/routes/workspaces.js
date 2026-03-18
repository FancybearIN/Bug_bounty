const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

const HIDDEN_WORKSPACES = [
  'HTTPX JSON Fix Test',
  'Filter API Test',
  'Filtered API Test',
  'Worker Tool Validation',
  'Worker Test WS',
  'Worker Test WS 2',
  'Recon Trigger WS',
  'Cross WS',
  'Henkel VDP Test',
];

// GET all workspaces
router.get('/', (req, res) => {
  const db = getDb();
  const placeholders = HIDDEN_WORKSPACES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT *
    FROM workspaces
    WHERE name NOT IN (${placeholders})
    ORDER BY created_at DESC
  `).all(...HIDDEN_WORKSPACES);
  db.close();
  res.json(rows);
});

// POST create workspace
router.post('/', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO workspaces (name, description) VALUES (?,?)').run(name.trim(), description || '');
    const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(result.lastInsertRowid);

    // Auto-seed checklist for new workspace
    const { CHECKLIST_DEFAULTS } = require('../db/seed');
    const stmt = db.prepare(`INSERT INTO checklist_items (workspace_id, category, title, severity, description, done) VALUES (?,?,?,?,?,0)`);
    for (const item of CHECKLIST_DEFAULTS) {
      stmt.run(ws.id, item.category, item.title, item.severity, item.description || '');
    }

    res.status(201).json(ws);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Workspace name already exists' });
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

// DELETE workspace
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM workspaces WHERE id=?').run(req.params.id);
  db.close();
  res.json({ success: true });
});

// PATCH rename/update workspace
router.patch('/:id', (req, res) => {
  const { name, description } = req.body;
  const nextDescription = description === undefined ? null : description;
  const db = getDb();
  try {
    db.prepare('UPDATE workspaces SET name=COALESCE(?,name), description=COALESCE(?,description) WHERE id=?')
      .run(name || null, nextDescription, req.params.id);
    const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(req.params.id);
    res.json(ws);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

module.exports = router;
