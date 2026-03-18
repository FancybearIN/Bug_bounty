const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

// GET /api/targets?workspace_id=1&type=domain
router.get('/', (req, res) => {
  const { workspace_id, type } = req.query;
  if (!workspace_id) {
    return res.status(400).json({ error: 'workspace_id required' });
  }

  const db = getDb();
  try {
    const params = [workspace_id];
    let sql = 'SELECT id, workspace_id, type, value, is_active, created_at FROM targets WHERE workspace_id = ?';

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    sql += ' ORDER BY value ASC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } finally {
    db.close();
  }
});

module.exports = router;
