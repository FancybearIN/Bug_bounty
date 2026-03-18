const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

router.post('/', (req, res) => {
  const { target_id, subdomain_id, tool } = req.body;

  if (!target_id || !tool) {
    return res.status(400).json({ error: 'target_id and tool required' });
  }

  const db = getDb();
  try {
    const target = db.prepare('SELECT id, workspace_id FROM targets WHERE id = ?').get(target_id);
    if (!target) {
      return res.status(404).json({ error: 'Target not found' });
    }

    if (subdomain_id) {
      const subdomain = db.prepare('SELECT id FROM subdomains WHERE id=? AND workspace_id=?').get(subdomain_id, target.workspace_id);
      if (!subdomain) return res.status(404).json({ error: 'Subdomain not found for target workspace' });
    }

    const result = db.prepare(`
      INSERT INTO jobs (workspace_id, target_id, subdomain_id, tool, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(target.workspace_id, target.id, subdomain_id || null, String(tool).trim());

    const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND workspace_id = ?').get(result.lastInsertRowid, target.workspace_id);
    res.status(201).json(job);
  } finally {
    db.close();
  }
});

router.get('/', (req, res) => {
  const { target_id, subdomain_id } = req.query;

  if (!target_id && !subdomain_id) {
    return res.status(400).json({ error: 'target_id or subdomain_id required' });
  }

  const db = getDb();
  try {
    let workspaceId = null;
    let whereSql = '';
    let params = [];

    if (subdomain_id) {
      const subdomain = db.prepare('SELECT id, workspace_id FROM subdomains WHERE id=?').get(subdomain_id);
      if (!subdomain) return res.status(404).json({ error: 'Subdomain not found' });
      workspaceId = subdomain.workspace_id;
      whereSql = 'subdomain_id = ? AND workspace_id = ?';
      params = [subdomain.id, workspaceId];
    } else {
      const target = db.prepare('SELECT id, workspace_id FROM targets WHERE id = ?').get(target_id);
      if (!target) {
        return res.status(404).json({ error: 'Target not found' });
      }
      workspaceId = target.workspace_id;
      whereSql = 'target_id = ? AND workspace_id = ?';
      params = [target.id, workspaceId];
    }

    const jobs = db.prepare(`
      SELECT * FROM jobs
      WHERE ${whereSql}
      ORDER BY created_at DESC
    `).all(...params);

    res.json(jobs);
  } finally {
    db.close();
  }
});

router.get('/:id/results', (req, res) => {
  const db = getDb();
  try {
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const rows = db.prepare(`
      SELECT * FROM job_results
      WHERE job_id = ?
      ORDER BY id ASC
    `).all(req.params.id);

    res.json(rows);
  } finally {
    db.close();
  }
});

module.exports = router;
