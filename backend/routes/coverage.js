const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

router.get('/', (req, res) => {
  const { target_id } = req.query;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = db.prepare('SELECT id, workspace_id FROM targets WHERE id=?').get(target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const totalRow = db.prepare('SELECT COUNT(*) AS count FROM checklist_items WHERE workspace_id=?').get(target.workspace_id);
    const total = Number(totalRow?.count || 0);

    const testedRow = db.prepare(`
      SELECT COUNT(*) AS count
      FROM target_checklists
      WHERE target_id = ?
        AND status IN ('testing','done','vulnerable')
    `).get(target.id);
    const vulnerableRow = db.prepare(`
      SELECT COUNT(*) AS count
      FROM target_checklists
      WHERE target_id = ?
        AND status = 'vulnerable'
    `).get(target.id);

    const tested = Number(testedRow?.count || 0);
    const vulnerable = Number(vulnerableRow?.count || 0);
    const percentage = total > 0 ? Math.round((tested / total) * 100) : 0;

    const moduleRows = db.prepare(`
      SELECT
        m.id,
        m.name,
        COUNT(c.id) AS total,
        SUM(CASE WHEN tc.status IN ('testing','done','vulnerable') THEN 1 ELSE 0 END) AS tested,
        SUM(CASE WHEN tc.status = 'vulnerable' THEN 1 ELSE 0 END) AS vulnerable
      FROM modules m
      LEFT JOIN checklist_items c
        ON c.linked_module_id = m.id
       AND c.workspace_id = m.workspace_id
      LEFT JOIN target_checklists tc
        ON tc.checklist_item_id = c.id
       AND tc.target_id = ?
      WHERE m.workspace_id = ?
      GROUP BY m.id, m.name
      ORDER BY m.name ASC
    `).all(target.id, target.workspace_id).map((row) => {
      const rowTotal = Number(row.total || 0);
      const rowTested = Number(row.tested || 0);
      const rowVulnerable = Number(row.vulnerable || 0);
      return {
        module_id: row.id,
        module_name: row.name,
        total: rowTotal,
        tested: rowTested,
        vulnerable: rowVulnerable,
        percentage: rowTotal > 0 ? Math.round((rowTested / rowTotal) * 100) : 0,
      };
    });

    res.json({
      target_id: Number(target.id),
      total,
      tested,
      vulnerable,
      percentage,
      modules: moduleRows,
    });
  } finally {
    db.close();
  }
});

module.exports = router;
