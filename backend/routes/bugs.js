const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

const VALID_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const VALID_STATUSES = ['Not Tested', 'Testing', 'Found', 'Reported', 'Duplicate'];

// GET bugs for workspace (with optional filters)
router.get('/', (req, res) => {
  const { workspace_id, severity, status, search } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  let sql = 'SELECT b.*, m.name as module_name FROM bugs b LEFT JOIN modules m ON b.module_id=m.id WHERE b.workspace_id=?';
  const params = [workspace_id];

  if (severity) { sql += ' AND b.severity=?'; params.push(severity); }
  if (status) { sql += ' AND b.status=?'; params.push(status); }
  if (search) {
    sql += ' AND (b.title LIKE ? OR b.target LIKE ? OR b.description LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  sql += " ORDER BY CASE b.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 4 END, b.created_at DESC";

  const db = getDb();
  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

// GET single bug
router.get('/:id', (req, res) => {
  const db = getDb();
  const bug = db.prepare('SELECT b.*, m.name as module_name FROM bugs b LEFT JOIN modules m ON b.module_id=m.id WHERE b.id=?').get(req.params.id);
  db.close();
  if (!bug) return res.status(404).json({ error: 'Not found' });
  res.json(bug);
});

// POST create bug
router.post('/', (req, res) => {
  const { workspace_id, title, severity, target, module_id, description, steps, impact, status, reported } = req.body;
  if (!workspace_id || !title || !severity) return res.status(400).json({ error: 'workspace_id, title, severity required' });
  if (!VALID_SEVERITIES.includes(severity)) return res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });

  const db = getDb();
  try {
    const r = db.prepare(`
      INSERT INTO bugs (workspace_id, title, severity, target, module_id, description, steps, impact, status, reported)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      workspace_id, title.trim(), severity,
      target || null, module_id || null,
      description || '', steps || '', impact || '',
      status || 'Not Tested', reported ? 1 : 0
    );
    const bug = db.prepare('SELECT b.*, m.name as module_name FROM bugs b LEFT JOIN modules m ON b.module_id=m.id WHERE b.id=?').get(r.lastInsertRowid);
    res.status(201).json(bug);
  } finally {
    db.close();
  }
});

// PATCH update bug
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM bugs WHERE id=?').get(req.params.id);
  if (!existing) { db.close(); return res.status(404).json({ error: 'Not found' }); }

  const { title, severity, target, module_id, description, steps, impact, status, reported } = req.body;

  if (severity && !VALID_SEVERITIES.includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare(`
    UPDATE bugs SET
      title=?, severity=?, target=?, module_id=?,
      description=?, steps=?, impact=?, status=?, reported=?
    WHERE id=?
  `).run(
    title ?? existing.title,
    severity ?? existing.severity,
    target !== undefined ? target : existing.target,
    module_id !== undefined ? module_id : existing.module_id,
    description ?? existing.description,
    steps ?? existing.steps,
    impact ?? existing.impact,
    status ?? existing.status,
    reported !== undefined ? (reported ? 1 : 0) : existing.reported,
    req.params.id
  );
  const bug = db.prepare('SELECT b.*, m.name as module_name FROM bugs b LEFT JOIN modules m ON b.module_id=m.id WHERE b.id=?').get(req.params.id);
  db.close();
  res.json(bug);
});

// DELETE bug
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM bugs WHERE id=?').run(req.params.id);
  db.close();
  res.json({ success: true });
});

module.exports = router;
