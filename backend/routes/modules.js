const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

// ── Helpers ──────────────────────────────────────────────

function buildTree(modules, endpoints) {
  const map = {};
  const roots = [];

  for (const m of modules) {
    map[m.id] = { ...m, children: [], endpoints: [] };
  }
  for (const e of endpoints) {
    try { e.parameters = JSON.parse(e.parameters || '[]'); } catch { e.parameters = []; }
    if (map[e.module_id]) map[e.module_id].endpoints.push(e);
  }
  for (const m of modules) {
    if (m.parent_id && map[m.parent_id]) {
      map[m.parent_id].children.push(map[m.id]);
    } else {
      roots.push(map[m.id]);
    }
  }
  return roots;
}

// ── Module Routes ──────────────────────────────────────

// GET module tree for workspace
router.get('/', (req, res) => {
  const { workspace_id, method, param, module_id, subdomain_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  const db = getDb();
  const modules = db.prepare('SELECT * FROM modules WHERE workspace_id=? ORDER BY parent_id ASC, name ASC').all(workspace_id);
  const moduleIds = modules.map(m => m.id);

  let endpoints = [];
  if (moduleIds.length) {
    const where = [`e.module_id IN (${moduleIds.map(() => '?').join(',')})`];
    const params = [...moduleIds];

    if (method) {
      where.push('e.method = ?');
      params.push(String(method).toUpperCase());
    }
    if (module_id) {
      where.push('e.module_id = ?');
      params.push(module_id);
    }
    if (subdomain_id) {
      where.push('e.subdomain_id = ?');
      params.push(subdomain_id);
    }
    if (param) {
      where.push('LOWER(e.parameters) LIKE ?');
      params.push(`%${String(param).toLowerCase()}%`);
    }

    endpoints = db.prepare(`
      SELECT
        e.*,
        s.value AS subdomain_value
      FROM endpoints e
      LEFT JOIN subdomains s ON s.id = e.subdomain_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.method, e.path
    `).all(...params);
  }

  db.close();
  res.json(buildTree(modules, endpoints));
});

// POST create module or submodule
router.post('/', (req, res) => {
  const { workspace_id, name, parent_id } = req.body;
  if (!workspace_id || !name) return res.status(400).json({ error: 'workspace_id and name required' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO modules (workspace_id, name, parent_id) VALUES (?,?,?)').run(workspace_id, name.trim(), parent_id || null);
    const mod = db.prepare('SELECT * FROM modules WHERE id=?').get(r.lastInsertRowid);
    res.status(201).json({ ...mod, children: [], endpoints: [] });
  } finally {
    db.close();
  }
});

// PATCH rename module
router.patch('/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  db.prepare('UPDATE modules SET name=? WHERE id=?').run(name.trim(), req.params.id);
  const mod = db.prepare('SELECT * FROM modules WHERE id=?').get(req.params.id);
  db.close();
  res.json(mod);
});

// DELETE module (cascades to children + endpoints)
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM modules WHERE id=?').run(req.params.id);
  db.close();
  res.json({ success: true });
});

// ── Endpoint Routes ────────────────────────────────────

// POST create endpoint
router.post('/:moduleId/endpoints', (req, res) => {
  const { method, path: ePath, parameters, notes, subdomain_id } = req.body;
  if (!method || !ePath) return res.status(400).json({ error: 'method and path required' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO endpoints (module_id, subdomain_id, method, path, parameters, notes) VALUES (?,?,?,?,?,?)')
      .run(req.params.moduleId, subdomain_id || null, method.toUpperCase(), ePath.trim(), JSON.stringify(parameters || []), notes || '');
    const ep = db.prepare('SELECT * FROM endpoints WHERE id=?').get(r.lastInsertRowid);
    ep.parameters = JSON.parse(ep.parameters || '[]');
    res.status(201).json(ep);
  } finally {
    db.close();
  }
});

// PATCH update endpoint
router.patch('/:moduleId/endpoints/:epId', (req, res) => {
  const { method, path: ePath, parameters, notes, tested, subdomain_id } = req.body;
  const db = getDb();
  const ep = db.prepare('SELECT * FROM endpoints WHERE id=?').get(req.params.epId);
  if (!ep) { db.close(); return res.status(404).json({ error: 'Not found' }); }

  const nextMethod = method?.toUpperCase() || ep.method;
  const nextPath = ePath?.trim() || ep.path;
  const nextParameters = JSON.stringify(Object.hasOwn(req.body, 'parameters') ? parameters : JSON.parse(ep.parameters || '[]'));
  const nextNotes = Object.hasOwn(req.body, 'notes') ? notes : ep.notes;
  let nextTested = ep.tested;
  if (Object.hasOwn(req.body, 'tested')) {
    nextTested = tested ? 1 : 0;
  }
  const nextSubdomainId = Object.hasOwn(req.body, 'subdomain_id') ? subdomain_id : ep.subdomain_id;

  db.prepare('UPDATE endpoints SET method=?, path=?, parameters=?, notes=?, tested=?, subdomain_id=? WHERE id=?').run(
    nextMethod,
    nextPath,
    nextParameters,
    nextNotes,
    nextTested,
    nextSubdomainId,
    req.params.epId
  );
  const updated = db.prepare('SELECT * FROM endpoints WHERE id=?').get(req.params.epId);
  updated.parameters = JSON.parse(updated.parameters || '[]');
  db.close();
  res.json(updated);
});

// DELETE endpoint
router.delete('/:moduleId/endpoints/:epId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM endpoints WHERE id=?').run(req.params.epId);
  db.close();
  res.json({ success: true });
});

module.exports = router;
