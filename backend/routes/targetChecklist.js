const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

const VALID_STATUS = new Set(['not_tested', 'testing', 'done', 'vulnerable']);

function resolveTargetWorkspace(db, targetId) {
  return db.prepare('SELECT workspace_id FROM targets WHERE id = ?').get(targetId) || null;
}

function hasLegacyTargetTypeColumn(db) {
  const cols = db.prepare('PRAGMA table_info(target_checklists)').all();
  return cols.some((c) => c.name === 'target_type');
}

// GET /api/target-checklist?target_id=1
router.get('/', (req, res) => {
  const { target_id } = req.query;

  if (!target_id) {
    return res.status(400).json({ error: 'target_id required' });
  }

  const db = getDb();
  try {
    const targetWorkspace = resolveTargetWorkspace(db, target_id);
    if (!targetWorkspace) {
      return res.status(404).json({ error: 'Target not found' });
    }

    const rows = db.prepare(`
      SELECT
        c.id,
        c.workspace_id,
        c.category,
        c.title,
        c.severity,
        c.description,
        c.linked_module_id,
        c.done,
        tc.id AS target_checklist_id,
        COALESCE(tc.status, 'not_tested') AS status,
        COALESCE(tc.notes, '') AS notes,
        tc.created_at AS target_updated_at
      FROM checklist_items c
      LEFT JOIN target_checklists tc
        ON tc.workspace_id = c.workspace_id
        AND tc.target_id = ?
        AND tc.checklist_item_id = c.id
      WHERE c.workspace_id = ?
      ORDER BY c.category,
        CASE c.severity
          WHEN 'Critical' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          WHEN 'Low' THEN 4
          ELSE 5
        END,
        c.id
    `).all(target_id, targetWorkspace.workspace_id);

    res.json({
      target: {
        id: Number(target_id),
        workspace_id: targetWorkspace.workspace_id,
      },
      total: rows.length,
      statuses: {
        not_tested: rows.filter((r) => r.status === 'not_tested').length,
        testing: rows.filter((r) => r.status === 'testing').length,
        done: rows.filter((r) => r.status === 'done').length,
        vulnerable: rows.filter((r) => r.status === 'vulnerable').length,
      },
      items: rows,
    });
  } finally {
    db.close();
  }
});

router.post('/update', (req, res) => {
  const { target_id, checklist_item_id, status, notes } = req.body;
  const hasNotes = Object.hasOwn(req.body, 'notes');

  if (!target_id || !checklist_item_id || !status) {
    return res.status(400).json({ error: 'target_id, checklist_item_id, status required' });
  }
  if (!VALID_STATUS.has(status)) {
    return res.status(400).json({ error: 'status must be one of not_tested, testing, done, vulnerable' });
  }

  const db = getDb();
  try {
    const targetWorkspace = resolveTargetWorkspace(db, target_id);
    if (!targetWorkspace) {
      return res.status(404).json({ error: 'Target not found' });
    }

    const checklistItem = db.prepare('SELECT id FROM checklist_items WHERE id=? AND workspace_id=?')
      .get(checklist_item_id, targetWorkspace.workspace_id);
    if (!checklistItem) {
      return res.status(400).json({ error: 'Checklist item does not belong to target workspace' });
    }

    const updateResult = db.prepare(`
      UPDATE target_checklists
      SET status=?, notes=?
      WHERE target_id=? AND checklist_item_id=?
    `).run(
      status,
      hasNotes ? notes : null,
      target_id,
      checklist_item_id
    );

    if (!updateResult.changes) {
      if (hasLegacyTargetTypeColumn(db)) {
        const target = db.prepare('SELECT type FROM targets WHERE id = ?').get(target_id);
        db.prepare(`
          INSERT INTO target_checklists (workspace_id, target_type, target_id, checklist_item_id, status, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          targetWorkspace.workspace_id,
          target.type,
          target_id,
          checklist_item_id,
          status,
          hasNotes ? notes : null
        );
      } else {
        db.prepare(`
          INSERT INTO target_checklists (workspace_id, target_id, checklist_item_id, status, notes)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          targetWorkspace.workspace_id,
          target_id,
          checklist_item_id,
          status,
          hasNotes ? notes : null
        );
      }
    }

    const updated = db.prepare(`
      SELECT *
      FROM target_checklists
      WHERE target_id=? AND checklist_item_id=?
    `).get(target_id, checklist_item_id);

    res.json(updated);
  } finally {
    db.close();
  }
});

module.exports = router;
