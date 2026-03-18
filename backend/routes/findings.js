const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

function getTargetWorkspace(db, targetId) {
  return db.prepare('SELECT id, workspace_id FROM targets WHERE id = ?').get(targetId) || null;
}

router.post('/', (req, res) => {
  const {
    target_id,
    checklist_item_id,
    title,
    severity,
    description,
    poc,
    impact,
    reported,
  } = req.body;

  if (!target_id || !title || !severity) {
    return res.status(400).json({ error: 'target_id, title, severity required' });
  }
  if (!VALID_SEVERITIES.has(severity)) {
    return res.status(400).json({ error: 'severity must be one of: critical, high, medium, low' });
  }

  const db = getDb();
  try {
    const target = getTargetWorkspace(db, target_id);
    if (!target) {
      return res.status(404).json({ error: 'Target not found' });
    }

    if (checklist_item_id !== undefined && checklist_item_id !== null) {
      const checklistItem = db.prepare('SELECT id FROM checklist_items WHERE id = ? AND workspace_id = ?')
        .get(checklist_item_id, target.workspace_id);
      if (!checklistItem) {
        return res.status(400).json({ error: 'checklist_item_id does not belong to target workspace' });
      }
    }

    const result = db.prepare(`
      INSERT INTO findings (workspace_id, target_id, checklist_item_id, title, severity, description, poc, impact, reported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      target.workspace_id,
      target.id,
      checklist_item_id ?? null,
      title.trim(),
      severity,
      description || '',
      poc || '',
      impact || '',
      reported ? 1 : 0
    );

    const finding = db.prepare('SELECT * FROM findings WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(finding);
  } finally {
    db.close();
  }
});

router.get('/', (req, res) => {
  const { target_id } = req.query;

  if (!target_id) {
    return res.status(400).json({ error: 'target_id required' });
  }

  const db = getDb();
  try {
    const target = getTargetWorkspace(db, target_id);
    if (!target) {
      return res.status(404).json({ error: 'Target not found' });
    }

    const findings = db.prepare(`
      SELECT * FROM findings
      WHERE target_id = ? AND workspace_id = ?
      ORDER BY created_at DESC
    `).all(target.id, target.workspace_id);

    res.json(findings);
  } finally {
    db.close();
  }
});

router.patch('/:id', (req, res) => {
  if (Object.hasOwn(req.body, 'target_id')) {
    return res.status(400).json({ error: 'target_id cannot be changed' });
  }

  const allowedFields = ['title', 'severity', 'description', 'poc', 'impact', 'reported'];
  const providedFields = allowedFields.filter((field) => Object.hasOwn(req.body, field));

  if (!providedFields.length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  if (Object.hasOwn(req.body, 'severity') && !VALID_SEVERITIES.has(req.body.severity)) {
    return res.status(400).json({ error: 'severity must be one of: critical, high, medium, low' });
  }

  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM findings WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Finding not found' });
    }

    let nextReported = existing.reported;
    if (Object.hasOwn(req.body, 'reported')) {
      nextReported = req.body.reported ? 1 : 0;
    }

    const updatedValues = {
      title: Object.hasOwn(req.body, 'title') ? req.body.title.trim() : existing.title,
      severity: Object.hasOwn(req.body, 'severity') ? req.body.severity : existing.severity,
      description: Object.hasOwn(req.body, 'description') ? req.body.description : existing.description,
      poc: Object.hasOwn(req.body, 'poc') ? req.body.poc : existing.poc,
      impact: Object.hasOwn(req.body, 'impact') ? req.body.impact : existing.impact,
      reported: nextReported,
    };

    db.prepare(`
      UPDATE findings
      SET title = ?, severity = ?, description = ?, poc = ?, impact = ?, reported = ?
      WHERE id = ?
    `).run(
      updatedValues.title,
      updatedValues.severity,
      updatedValues.description,
      updatedValues.poc,
      updatedValues.impact,
      updatedValues.reported,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM findings WHERE id = ?').get(req.params.id);
    res.json(updated);
  } finally {
    db.close();
  }
});

module.exports = router;
