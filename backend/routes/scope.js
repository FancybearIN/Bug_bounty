const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getDb } = require('../db/init');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Helpers ──────────────────────────────────────────────

function normalizeHostLikeValue(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/:\d+$/, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

function stripWWW(domain) {
  return normalizeHostLikeValue(domain).replace(/^www\./, '');
}

function classifyEntry(value) {
  if (value.startsWith('*.')) return 'wildcard';
  if (value.includes('api')) return 'api';
  if (/^com\.|^org\.|^io\./.test(value)) return 'mobile';
  return 'domain';
}

function isValidDomain(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
}

function parseHackerOneHostPattern(rawHost) {
  const host = normalizeHostLikeValue(String(rawHost || ''));
  if (!host) return null;

  const hasRegexTokens = /[\\^$()[\]{}+?]/.test(host) || host.includes('.*');
  if (!hasRegexTokens) {
    const isWildcard = valueStartsWithWildcard(host);
    const normalizedDomain = normalizeDomain(host.replace(/^\*\./, ''));
    if (!isValidDomain(normalizedDomain)) return null;
    return {
      value: isWildcard ? `*.${normalizedDomain}` : normalizedDomain,
      type: isWildcard ? 'wildcard' : 'domain',
    };
  }

  // Extract trailing concrete domain from regex hosts like ^.*\.henkel\.com$ or ^www\.joico\.com$.
  const suffixMatch = host.match(/([a-z0-9-]+(?:\\\.[a-z0-9-]+)+)\$?$/i);
  if (!suffixMatch) return null;

  const concreteDomain = suffixMatch[1].replaceAll(String.raw`\.`, '.').toLowerCase();
  if (!isValidDomain(concreteDomain)) return null;

  const isWildcard = /^\^?\.\*\\\./.test(host);
  return {
    value: isWildcard ? `*.${concreteDomain}` : concreteDomain,
    type: isWildcard ? 'wildcard' : 'domain',
  };
}

function valueStartsWithWildcard(value) {
  return String(value || '').trim().startsWith('*.');
}

function normalizeScopeValueByType(type, value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (type === 'domain' || type === 'wildcard' || type === 'api') {
    const isWildcard = type === 'wildcard' || valueStartsWithWildcard(raw);
    const normalized = normalizeDomain(raw.replace(/^\*\./, ''));
    if (!isValidDomain(normalized)) return null;
    return isWildcard ? `*.${normalized}` : normalized;
  }

  return normalizeHostLikeValue(raw);
}

function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];

  for (const entry of entries || []) {
    const type = String(entry?.type || '').trim().toLowerCase();
    const normalizedValue = normalizeScopeValueByType(type, entry?.value);
    if (!type || !normalizedValue) continue;

    const dedupeValue = normalizedValue.replace(/^\*\./, '');
    const key = `${type}:${dedupeValue}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      type,
      value: normalizedValue,
      notes: String(entry?.notes || '').trim(),
    });
  }

  return out;
}

function extractHackerOneIncludeEntries(data) {
  const include = data?.target?.scope?.include;
  if (!Array.isArray(include)) return [];

  const entries = [];
  for (const item of include) {
    const parsedHost = parseHackerOneHostPattern(item?.host);
    if (!parsedHost) continue;

    const notesParts = [];
    if (item?.protocol) notesParts.push(`protocol=${String(item.protocol).toLowerCase()}`);
    if (item?.port) notesParts.push(`port=${String(item.port)}`);

    entries.push({
      type: parsedHost.type,
      value: parsedHost.value,
      notes: notesParts.join(' '),
    });
  }

  return entries;
}

function parseHackerOneJSONFromObject(data) {
  const includeEntries = extractHackerOneIncludeEntries(data);
  if (includeEntries.length) return includeEntries;

  const entries = [];
  const targets = data.relationships?.eligible_bounties?.data ||
                  data.data?.relationships?.structured_scopes?.data ||
                  data.attributes?.structured_scopes ||
                  data.targets || [];

  for (const t of targets) {
    const attr = t.attributes || t;
    const value = (attr.asset_identifier || attr.target || '').trim();
    const type = attr.asset_type?.toLowerCase() || '';
    if (!value) continue;

    let entryType;
    if (type.includes('url') || type.includes('domain')) {
      entryType = value.startsWith('*.') ? 'wildcard' : 'domain';
    } else if (type.includes('mobile') || type.includes('app')) {
      entryType = 'mobile';
    } else if (type.includes('api')) {
      entryType = 'api';
    } else {
      entryType = classifyEntry(value);
    }

    entries.push({ type: entryType, value: stripWWW(value), notes: attr.instruction || '' });
  }
  return entries;
}

function parseBugcrowdJSON(raw) {
  try {
    const data = JSON.parse(raw);
    const entries = [];
    const targets = data.targets || data.scope_items || [];
    for (const t of targets) {
      const value = (t.target || t.uri || t.name || '').trim();
      if (!value) continue;
      entries.push({ type: classifyEntry(value), value: stripWWW(value), notes: t.description || '' });
    }
    return entries;
  } catch {
    return [];
  }
}

function parseTXTScope(raw) {
  return raw.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => ({ type: classifyEntry(l), value: stripWWW(l), notes: '' }));
}

function normalizeTargetDomain(value) {
  const normalized = normalizeDomain(value).replace(/^\*\./, '');
  if (!normalized?.includes('.')) return null;
  return normalized;
}

function extractTargetDomains(entries) {
  const out = new Set();
  for (const e of entries) {
    if (e.type !== 'domain' && e.type !== 'wildcard') continue;
    const domain = normalizeTargetDomain(e.value);
    if (domain) out.add(domain);
  }
  return [...out];
}

function createOrGetTarget(db, workspaceId, domain, makeActive = false) {
  db.prepare("INSERT OR IGNORE INTO targets (workspace_id, type, value) VALUES (?, 'domain', ?)").run(workspaceId, domain);
  const target = db.prepare("SELECT id, workspace_id, value FROM targets WHERE workspace_id=? AND type='domain' AND value=?").get(workspaceId, domain);
  if (!target) return null;

  if (makeActive) {
    db.prepare("UPDATE targets SET is_active=CASE WHEN id=? THEN 1 ELSE 0 END WHERE workspace_id=? AND type='domain'")
      .run(target.id, workspaceId);
  }

  return target;
}

function createOrGetBaseSubdomain(db, workspaceId, targetId, domain) {
  db.prepare(`
    INSERT INTO subdomains (workspace_id, target_id, value, is_active, discovery_source)
    SELECT ?, ?, ?, 1, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM subdomains WHERE workspace_id=? AND value=?
    )
  `).run(workspaceId, targetId, domain, JSON.stringify(['scope']), workspaceId, domain);

  db.prepare('UPDATE subdomains SET target_id=COALESCE(target_id, ?), is_active=1 WHERE workspace_id=? AND value=?')
    .run(targetId, workspaceId, domain);

  return db.prepare('SELECT * FROM subdomains WHERE workspace_id=? AND value=?').get(workspaceId, domain);
}

function queueAutoReconJobsIfEnabled(db, workspaceId, targetId) {
  const ws = db.prepare('SELECT auto_recon_mode FROM workspaces WHERE id=?').get(workspaceId);
  if (!ws || Number(ws.auto_recon_mode) !== 1) return 0;

  const tools = ['subfinder', 'assetfinder', 'chaos', 'httpx'];
  const stmt = db.prepare(`
    INSERT INTO jobs (workspace_id, target_id, tool, status)
    SELECT ?, ?, ?, 'pending'
    WHERE NOT EXISTS (
      SELECT 1 FROM jobs
      WHERE workspace_id=?
        AND target_id=?
        AND tool=?
        AND status IN ('pending','running')
    )
  `);

  let created = 0;
  for (const tool of tools) {
    const r = stmt.run(workspaceId, targetId, tool, workspaceId, targetId, tool);
    created += r.changes;
  }

  return created;
}

function resolveWorkspaceId(db, workspaceId, workspaceName, workspaceDescription) {
  if (workspaceId) {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId);
    return ws ? ws.id : null;
  }

  if (!workspaceName) return null;

  const existing = db.prepare('SELECT id FROM workspaces WHERE name=?').get(workspaceName.trim());
  if (existing) return existing.id;

  const created = db.prepare('INSERT INTO workspaces (name, description) VALUES (?, ?)')
    .run(workspaceName.trim(), workspaceDescription || '');
  return created.lastInsertRowid;
}

function parseScopeUpload(filename, raw) {
  if (filename.endsWith('.json')) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { entries: [], invalidJson: true };
    }

    let entries = parseHackerOneJSONFromObject(parsed);
    if (!entries.length) entries = parseBugcrowdJSON(raw);
    if (!entries.length) {
      try {
        const flat = JSON.stringify(parsed);
        const matches = flat.match(/[*a-z0-9.-]+\.[a-z]{2,}/gi) || [];
        entries = [...new Set(matches)].map(v => ({ type: classifyEntry(v), value: v, notes: '' }));
      } catch {
        entries = [];
      }
    }
    return { entries, invalidJson: false };
  }

  return { entries: parseTXTScope(raw), invalidJson: false };
}

// ── Routes ──────────────────────────────────────────────

// GET scope for workspace
router.get('/', (req, res) => {
  const { workspace_id, only_active } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  const db = getDb();
  const onlyActive = String(only_active || '').toLowerCase() === 'true';
  const rows = onlyActive
    ? db.prepare('SELECT * FROM scope_entries WHERE workspace_id=? AND is_active=1 ORDER BY type,value').all(workspace_id)
    : db.prepare('SELECT * FROM scope_entries WHERE workspace_id=? ORDER BY type,value').all(workspace_id);
  db.close();
  res.json(rows);
});

// POST upload scope file
router.post('/upload', upload.single('file'), (req, res) => {
  const { workspace_id, workspace_name, workspace_description } = req.body;
  if (!workspace_id && !workspace_name) {
    return res.status(400).json({ error: 'workspace_id or workspace_name required' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const raw = req.file.buffer.toString('utf8');
  const filename = req.file.originalname.toLowerCase();
  const parsedUpload = parseScopeUpload(filename, raw);
  const entries = dedupeEntries(parsedUpload.entries);

  if (parsedUpload.invalidJson) {
    return res.status(400).json({ error: 'Invalid JSON file' });
  }

  if (!entries.length) {
    return res.json({ success: true, imported: 0, workspace_id: null });
  }

  const db = getDb();
  try {
    const resolvedWorkspaceId = resolveWorkspaceId(db, workspace_id, workspace_name, workspace_description);
    if (!resolvedWorkspaceId) return res.status(404).json({ error: 'Workspace not found' });

    const scopeStmt = db.prepare(`
      INSERT INTO scope_entries (workspace_id, type, value, notes)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM scope_entries
        WHERE workspace_id = ? AND type = ? AND value = ?
      )
    `);
    let inserted = 0;
    for (const e of entries) {
      const r = scopeStmt.run(
        resolvedWorkspaceId,
        e.type,
        e.value,
        e.notes,
        resolvedWorkspaceId,
        e.type,
        e.value
      );
      inserted += r.changes;
    }

    const targetDomains = extractTargetDomains(entries);
    const targetStmt = db.prepare("INSERT OR IGNORE INTO targets (workspace_id, type, value) VALUES (?, 'domain', ?)");
    let targetsInserted = 0;
    const targetIdMap = new Map();
    for (const domain of targetDomains) {
      const r = targetStmt.run(resolvedWorkspaceId, domain);
      targetsInserted += r.changes;
      const target = db.prepare("SELECT id FROM targets WHERE workspace_id=? AND type='domain' AND value=?").get(resolvedWorkspaceId, domain);
      if (target) targetIdMap.set(domain, target.id);
    }

    // Auto-generate base subdomains from scope domains
    const subdomainStmt = db.prepare(`
      INSERT INTO subdomains (workspace_id, target_id, value)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM subdomains
        WHERE workspace_id = ? AND value = ?
      )
    `);
    let subdomainsInserted = 0;
    let autoJobsCreated = 0;
    for (const domain of targetDomains) {
      const targetId = targetIdMap.get(domain);
      if (!targetId) continue;
      const normalizedDomain = normalizeDomain(domain).replace(/^\*\./, '');
      const r = subdomainStmt.run(
        resolvedWorkspaceId,
        targetId,
        normalizedDomain,
        resolvedWorkspaceId,
        normalizedDomain
      );
      subdomainsInserted += r.changes;
      autoJobsCreated += queueAutoReconJobsIfEnabled(db, resolvedWorkspaceId, targetId);
    }

    const all = db.prepare('SELECT * FROM scope_entries WHERE workspace_id=? ORDER BY type,value').all(resolvedWorkspaceId);
    const targetsTotal = db.prepare("SELECT COUNT(*) AS count FROM targets WHERE workspace_id=? AND type='domain'").get(resolvedWorkspaceId).count;

    res.json({
      success: true,
      imported: targetsInserted,
      workspace_id: resolvedWorkspaceId,
      inserted,
      total: all.length,
      entries: all,
      targets_created: targetsInserted,
      targets_total: targetsTotal,
      subdomains_auto_created: subdomainsInserted,
      auto_jobs_created: autoJobsCreated,
    });
  } finally {
    db.close();
  }
});

// POST add single scope entry
router.post('/', (req, res) => {
  const { workspace_id, type, value, notes } = req.body;
  if (!workspace_id || !type || !value) return res.status(400).json({ error: 'workspace_id, type, value required' });

  const normalizedType = String(type).trim().toLowerCase();
  const normalizedValue = normalizeScopeValueByType(normalizedType, value);
  if (!normalizedValue) return res.status(400).json({ error: 'Invalid scope value' });

  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO scope_entries (workspace_id, type, value, notes)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM scope_entries
        WHERE workspace_id = ? AND type = ? AND value = ?
      )
    `).run(
      workspace_id,
      normalizedType,
      normalizedValue,
      notes || '',
      workspace_id,
      normalizedType,
      normalizedValue
    );

    const entry = db.prepare('SELECT * FROM scope_entries WHERE workspace_id=? AND type=? AND value=?').get(workspace_id, normalizedType, normalizedValue);

    if (entry && isDomainScopeEntry(entry)) {
      const domain = normalizeTargetDomain(entry.value);
      if (domain) {
        const target = createOrGetTarget(db, workspace_id, domain, false);
        if (target) {
          createOrGetBaseSubdomain(db, workspace_id, target.id, domain);
          queueAutoReconJobsIfEnabled(db, workspace_id, target.id);
        }
      }
    }

    res.status(201).json(entry);
  } finally {
    db.close();
  }
});

function isDomainScopeEntry(entry) {
  return entry?.type === 'domain' || entry?.type === 'wildcard';
}

router.patch('/:id/active', (req, res) => {
  const { is_active } = req.body;
  const isActive = Number(is_active) ? 1 : 0;
  const db = getDb();
  try {
    const entry = db.prepare('SELECT * FROM scope_entries WHERE id=?').get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Scope entry not found' });

    db.prepare('UPDATE scope_entries SET is_active=? WHERE id=?').run(isActive, req.params.id);
    const updated = db.prepare('SELECT * FROM scope_entries WHERE id=?').get(req.params.id);
    res.json(updated);
  } finally {
    db.close();
  }
});

router.post('/:id/add-to-recon', (req, res) => {
  const db = getDb();
  try {
    const entry = db.prepare('SELECT * FROM scope_entries WHERE id=?').get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Scope entry not found' });

    const domain = normalizeTargetDomain(entry.value);
    if (!domain) return res.status(400).json({ error: 'Scope entry is not a valid domain' });

    db.prepare('UPDATE scope_entries SET is_active=1 WHERE id=?').run(req.params.id);
    const target = createOrGetTarget(db, entry.workspace_id, domain, true);
    if (!target) return res.status(500).json({ error: 'Failed to create target' });

    const subdomain = createOrGetBaseSubdomain(db, entry.workspace_id, target.id, domain);
    const jobs_created = queueAutoReconJobsIfEnabled(db, entry.workspace_id, target.id);

    res.json({
      success: true,
      scope_entry_id: Number(req.params.id),
      workspace_id: entry.workspace_id,
      target,
      subdomain,
      jobs_created,
    });
  } finally {
    db.close();
  }
});

// DELETE scope entry
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM scope_entries WHERE id=?').run(req.params.id);
  db.close();
  res.json({ success: true });
});

module.exports = router;
