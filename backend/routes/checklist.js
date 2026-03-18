const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

// GET checklist for workspace, grouped by category
router.get('/', (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  const db = getDb();
  const rows = db.prepare(`
    SELECT c.*, m.name as linked_module_name
    FROM checklist_items c
    LEFT JOIN modules m ON c.linked_module_id = m.id
    WHERE c.workspace_id=?
    ORDER BY c.category, CASE c.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 4 END
  `).all(workspace_id);
  db.close();

  // Group by category
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }
  res.json({ categories: grouped, total: rows.length, done: rows.filter(r => r.done).length });
});

// PATCH toggle done status
router.patch('/:id', (req, res) => {
  const { done, linked_module_id } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id);
  if (!existing) { db.close(); return res.status(404).json({ error: 'Not found' }); }

  db.prepare('UPDATE checklist_items SET done=?, linked_module_id=? WHERE id=?').run(
    done !== undefined ? (done ? 1 : 0) : existing.done,
    linked_module_id !== undefined ? linked_module_id : existing.linked_module_id,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id);
  db.close();
  res.json(updated);
});

// POST add custom checklist item
router.post('/', (req, res) => {
  const { workspace_id, category, title, severity, description } = req.body;
  if (!workspace_id || !category || !title || !severity) {
    return res.status(400).json({ error: 'workspace_id, category, title, severity required' });
  }
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO checklist_items (workspace_id, category, title, severity, description) VALUES (?,?,?,?,?)').run(
      workspace_id, category.trim(), title.trim(), severity, description || ''
    );
    const item = db.prepare('SELECT * FROM checklist_items WHERE id=?').get(r.lastInsertRowid);
    res.status(201).json(item);
  } finally {
    db.close();
  }
});

// DELETE checklist item
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM checklist_items WHERE id=?').run(req.params.id);
  db.close();
  res.json({ success: true });
});

// POST bulk reset (mark all undone for workspace)
router.post('/reset', (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  const db = getDb();
  db.prepare('UPDATE checklist_items SET done=0 WHERE workspace_id=?').run(workspace_id);
  db.close();
  res.json({ success: true });
});

module.exports = router;
