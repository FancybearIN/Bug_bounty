const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getDb } = require('../db/init');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Helpers ──────────────────────────────────────────────

function normalizeSubdomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

const jsonFields = ['httpx_data', 'dirsearch_data', 'wayback_data', 'params_data'];

function parseSubdomain(row) {
  const out = { ...row };
  for (const f of jsonFields) {
    try { out[f] = JSON.parse(row[f] || '{}'); } catch { out[f] = {}; }
    if (f !== 'httpx_data' && typeof out[f] !== 'object') out[f] = [];
  }
  try { out.tags = JSON.parse(row.tags || '[]'); } catch { out.tags = []; }
  try { out.discovery_source = JSON.parse(row.discovery_source || '[]'); } catch { out.discovery_source = []; }
  out.is_active = Number(row.is_active) === 1;
  out.is_alive = Number(row.is_alive) === 1;
  return out;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value || '').trim().toLowerCase();
  if (!s) return false;
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function normalizeTechList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function parseHttpxIntelligence(row) {
  const raw = String(row.httpx_data || '').trim();
  if (!raw || raw === '{}' || raw === 'null') return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object') return null;

  const statusNum = Number(data.status);
  const status = Number.isNaN(statusNum) ? null : statusNum;

  return {
    id: row.id,
    subdomain: row.value,
    status,
    title: String(data.title || ''),
    tech: normalizeTechList(data.tech),
    server: String(data.server || data.web_server || ''),
    ip: String(data.ip || ''),
    cdn: toBool(data.cdn),
    has_params: Array.isArray(safeParseJson(row.params_data || '[]', [])).some((item) => {
      if (!item) return false;
      if (Array.isArray(item?.params) && item.params.length > 0) return true;
      if (typeof item === 'string') return item.includes('=');
      return false;
    }),
    tags: safeParseJson(row.tags || '[]', []),
    created_at: row.created_at || null,
  };
}

function extractRootDomain(value) {
  const host = normalizeSubdomain(value);
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return host;
  return parts.slice(-2).join('.');
}

function getNodeCount(node) {
  let count = node.id ? 1 : 0;
  for (const child of Object.values(node.children || {})) {
    count += getNodeCount(child);
  }
  return count;
}

function ensureTreeNode(store, domain) {
  if (!store[domain]) {
    store[domain] = { id: null, value: domain, children: {} };
  }
  return store[domain];
}

function groupSubdomainsByRootDomain(subdomains) {
  const roots = {};

  const sorted = [...subdomains].sort((a, b) => a.value.length - b.value.length);
  for (const row of sorted) {
    const full = normalizeSubdomain(row.value);
    if (!full) continue;
    const root = extractRootDomain(full);
    if (!roots[root]) roots[root] = { count: 0, children: {} };

    const labels = full.split('.');
    let cursor = roots[root].children;
    for (let i = labels.length - 3; i >= 0; i -= 1) {
      const segment = labels.slice(i).join('.');
      const node = ensureTreeNode(cursor, segment);
      cursor = node.children;
    }

    const leaf = ensureTreeNode(roots[root].children, full);
    leaf.id = row.id;
    leaf.value = full;
  }

  for (const root of Object.keys(roots)) {
    let count = 0;
    for (const child of Object.values(roots[root].children)) {
      count += getNodeCount(child);
    }
    roots[root].count = count;
  }

  return roots;
}

function getWorkspaceTargets(db, workspaceId) {
  return db.prepare("SELECT id, value FROM targets WHERE workspace_id=? AND type='domain'").all(workspaceId);
}

function getSubdomainsTableColumns(db) {
  return new Set(db.prepare('PRAGMA table_info(subdomains)').all().map((c) => c.name));
}

function resolveTargetIdForSubdomain(targetRows, subdomain) {
  const host = normalizeSubdomain(subdomain);
  if (!host?.includes('.')) return null;

  let best = null;
  for (const target of targetRows) {
    const domain = normalizeSubdomain(target.value);
    if (!domain || (host !== domain && !host.endsWith(`.${domain}`))) continue;
    if (!best || domain.length > best.domain.length) {
      best = { id: target.id, domain };
    }
  }
  return best ? best.id : null;
}

function applyIntelligenceFilters(items, filters) {
  let out = items;

  if (filters.status !== undefined) {
    const n = Number(filters.status);
    if (!Number.isNaN(n)) {
      out = out.filter((r) => r.status === n);
    }
  }

  if (filters.tech) {
    const needle = String(filters.tech).trim().toLowerCase();
    out = out.filter((r) => r.tech.some((t) => String(t).toLowerCase().includes(needle)));
  }

  if (filters.cdn !== undefined) {
    const cdnRequired = String(filters.cdn).toLowerCase() === 'true';
    out = out.filter((r) => r.cdn === cdnRequired);
  }

  if (filters.keyword) {
    const kw = String(filters.keyword).trim().toLowerCase();
    out = out.filter((r) =>
      r.subdomain.toLowerCase().includes(kw) ||
      r.title.toLowerCase().includes(kw)
    );
  }

  if (filters.has_params !== undefined) {
    const required = String(filters.has_params).toLowerCase() === 'true';
    out = out.filter((r) => Boolean(r.has_params) === required);
  }

  if (filters.tag) {
    const needle = String(filters.tag).trim().toLowerCase();
    out = out.filter((r) => Array.isArray(r.tags) && r.tags.some((t) => String(t).toLowerCase().includes(needle)));
  }

  return out;
}

function sortIntelligence(items, sortKey) {
  const out = [...items];
  if (sortKey === 'status') {
    out.sort((a, b) => (a.status ?? 9999) - (b.status ?? 9999));
    return out;
  }
  if (sortKey === 'created_at') {
    out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return out;
  }
  out.sort((a, b) => a.subdomain.localeCompare(b.subdomain));
  return out;
}

// ── Routes ──────────────────────────────────────────────

// GET all subdomains for workspace
router.get('/', (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  const db = getDb();
  const rows = db.prepare('SELECT * FROM subdomains WHERE workspace_id=? ORDER BY value').all(workspace_id);
  db.close();
  res.json(rows.map(parseSubdomain));
});

// GET subdomain tree for workspace
router.get('/tree', (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  const db = getDb();
  try {
    const rows = db.prepare('SELECT id, value FROM subdomains WHERE workspace_id=? ORDER BY value').all(workspace_id);
    const tree = groupSubdomainsByRootDomain(rows);
    res.json({ workspace_id: Number(workspace_id), tree });
  } finally {
    db.close();
  }
});

// GET filtered httpx intelligence for a target
router.get('/filtered', (req, res) => {
  const { target_id, status, tech, cdn, keyword, sort, has_params, tag } = req.query;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = db.prepare('SELECT id, workspace_id, value FROM targets WHERE id=?').get(target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const columns = new Set(db.prepare('PRAGMA table_info(subdomains)').all().map((c) => c.name));
    const hasCreatedAt = columns.has('created_at');
    if (!columns.has('target_id')) {
      return res.status(500).json({ error: 'target_id column missing on subdomains; restart server to run migrations' });
    }

    const rows = hasCreatedAt
      ? db.prepare('SELECT id, value, httpx_data, params_data, tags, created_at FROM subdomains WHERE target_id = ?').all(target_id)
      : db.prepare('SELECT id, value, httpx_data, params_data, tags, NULL AS created_at FROM subdomains WHERE target_id = ?').all(target_id);

    const parsed = rows
      .map(parseHttpxIntelligence)
      .filter(Boolean);

    const filtered = applyIntelligenceFilters(parsed, { status, tech, cdn, keyword, has_params, tag });
    const sorted = sortIntelligence(filtered, sort);

    const results = sorted.map(({ created_at, ...item }) => item);
    res.json({ target_id: Number(target_id), total: results.length, results });
  } finally {
    db.close();
  }
});

// GET single subdomain detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM subdomains WHERE id=?').get(req.params.id);
  db.close();
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parseSubdomain(row));
});

// POST add single subdomain
router.post('/', (req, res) => {
  const { workspace_id, value } = req.body;
  if (!workspace_id || !value) {
    console.error('Invalid payload:', req.body);
    return res.status(400).json({ error: 'workspace_id and value required' });
  }

  const workspaceIdNum = Number(workspace_id);
  const rawValue = String(value || '').trim();
  if (!Number.isInteger(workspaceIdNum) || workspaceIdNum <= 0 || !rawValue) {
    console.error('Invalid payload:', req.body);
    return res.status(400).json({ error: 'workspace_id and value required' });
  }

  const normalized = normalizeSubdomain(rawValue);
  if (!normalized) {
    console.error('Invalid payload:', req.body);
    return res.status(400).json({ error: 'workspace_id and value required' });
  }

  const db = getDb();
  try {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceIdNum);
    if (!ws) {
      console.error('Invalid payload:', req.body);
      return res.status(400).json({ error: 'workspace_id and value required' });
    }

    const cols = getSubdomainsTableColumns(db);
    const targetRows = getWorkspaceTargets(db, workspaceIdNum);
    const targetId = resolveTargetIdForSubdomain(targetRows, normalized);
    console.log('Inserting subdomain:', workspaceIdNum, normalized);

    if (cols.has('target_id')) {
      db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, target_id, value) VALUES (?,?,?)').run(workspaceIdNum, targetId, normalized);
      if (targetId) {
        db.prepare('UPDATE subdomains SET target_id=COALESCE(target_id, ?) WHERE workspace_id=? AND value=?').run(targetId, workspaceIdNum, normalized);
      }
    } else {
      db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, value) VALUES (?,?)').run(workspaceIdNum, normalized);
    }

    const row = db.prepare('SELECT * FROM subdomains WHERE workspace_id=? AND value=?').get(workspaceIdNum, normalized);
    if (!row) {
      throw new Error('Insert ignored and no matching row found');
    }
    res.status(201).json(parseSubdomain(row));
  } catch (e) {
    console.error('Subdomain insert error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

// POST upload TXT file of subdomains
router.post('/upload', upload.single('file'), (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const raw = req.file.buffer.toString('utf8');
  const lines = raw.split('\n').map(l => normalizeSubdomain(l)).filter(l => l?.includes('.'));
  const unique = [...new Set(lines)];

  const db = getDb();
  const cols = getSubdomainsTableColumns(db);
  const targetRows = getWorkspaceTargets(db, workspace_id);
  const stmt = cols.has('target_id')
    ? db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, target_id, value) VALUES (?,?,?)')
    : db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, value) VALUES (?,?)');
  let inserted = 0;
  for (const v of unique) {
    const targetId = resolveTargetIdForSubdomain(targetRows, v);
    const r = cols.has('target_id') ? stmt.run(workspace_id, targetId, v) : stmt.run(workspace_id, v);
    inserted += r.changes;
  }
  const all = db.prepare('SELECT * FROM subdomains WHERE workspace_id=? ORDER BY value').all(workspace_id);
  db.close();
  res.json({ inserted, total: all.length, subdomains: all.map(parseSubdomain) });
});

// PATCH update subdomain data (httpx, dirsearch, wayback, params, tags)
router.patch('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM subdomains WHERE id=?').get(req.params.id);
  if (!row) { db.close(); return res.status(404).json({ error: 'Not found' }); }

  const updates = {};
  for (const f of jsonFields) {
    if (req.body[f] !== undefined) updates[f] = JSON.stringify(req.body[f]);
  }
  if (req.body.tags !== undefined) updates.tags = JSON.stringify(req.body.tags);
  if (req.body.value !== undefined) updates.value = normalizeSubdomain(req.body.value);
  if (req.body.discovery_source !== undefined) updates.discovery_source = JSON.stringify(req.body.discovery_source || []);
  if (req.body.is_active !== undefined) updates.is_active = req.body.is_active ? 1 : 0;
  if (req.body.is_alive !== undefined) updates.is_alive = req.body.is_alive ? 1 : 0;

  if (!Object.keys(updates).length) { db.close(); return res.json(parseSubdomain(row)); }

  const setClauses = Object.keys(updates).map(k => `${k}=?`).join(', ');
  const values = [...Object.values(updates), req.params.id];
  db.prepare(`UPDATE subdomains SET ${setClauses} WHERE id=?`).run(...values);
  const updated = db.prepare('SELECT * FROM subdomains WHERE id=?').get(req.params.id);
  db.close();
  res.json(parseSubdomain(updated));
});

// DELETE subdomain
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM subdomains WHERE id=?').run(req.params.id);
  db.close();
  res.json({ success: true });
});

module.exports = router;
