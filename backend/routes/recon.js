const express = require('express');
const { spawnSync } = require('node:child_process');
const { getDb } = require('../db/init');

const router = express.Router();

function isToolAvailable(tool) {
  const result = spawnSync(tool, ['-h'], { stdio: 'ignore', timeout: 2000 });
  return result.error?.code !== 'ENOENT';
}

function normalizeHostLikeValue(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

function isValidDomain(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);
}

function parseJsonSafe(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function alphaSort(a, b) {
  return String(a).localeCompare(String(b));
}

function mergeUniqueByKey(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

function getTarget(db, targetId) {
  return db.prepare('SELECT id, workspace_id, value FROM targets WHERE id = ?').get(targetId) || null;
}

function getWorkspaceColumns(db) {
  return new Set(db.prepare('PRAGMA table_info(subdomains)').all().map((c) => c.name));
}

function upsertSubdomainForTarget(db, target, host) {
  const normalized = normalizeHostLikeValue(host);
  if (!normalized || !isValidDomain(normalized)) return null;

  const cols = getWorkspaceColumns(db);
  if (cols.has('target_id')) {
    db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, target_id, value) VALUES (?,?,?)')
      .run(target.workspace_id, target.id, normalized);
    db.prepare('UPDATE subdomains SET target_id = COALESCE(target_id, ?) WHERE workspace_id=? AND value=?')
      .run(target.id, target.workspace_id, normalized);
  } else {
    db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, value) VALUES (?,?)')
      .run(target.workspace_id, normalized);
  }

  return db.prepare('SELECT * FROM subdomains WHERE workspace_id=? AND value=?').get(target.workspace_id, normalized);
}

function normalizeUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const host = u.hostname.toLowerCase();
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${host}${port}${u.pathname}${u.search}`;
  } catch {
    return String(value || '').trim();
  }
}

function parseHttpxPayload(body) {
  if (Array.isArray(body?.records)) return body.records;
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && body.url) return [body];

  const raw = String(body?.content || body?.raw || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {
    // JSONL fallback
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJsonSafe(line, null))
    .filter(Boolean);
}

function parseDirsearchPayload(body) {
  const raw = String(body?.content || body?.raw || '').trim();
  if (!raw) return [];

  const statusRegex = /\b(200|301|302|403)\b/;
  const urlRegex = /https?:\/\/[^\s]+/i;
  const pathRegex = /\/(?:[^\s]+)/;
  const sizedRegex = /\b(\d+)\s*(?:b|bytes?)\b/i;
  const trailingNumRegex = /\b(\d+)\b(?!.*\b\d+\b)/;

  function parseLine(trimmed) {
    const statusMatch = statusRegex.exec(trimmed);
    if (!statusMatch) return null;

    const status = Number(statusMatch[1]);
    const sizeMatch = sizedRegex.exec(trimmed) || trailingNumRegex.exec(trimmed);
    const size = sizeMatch ? Number(sizeMatch[1]) : 0;

    const urlMatch = urlRegex.exec(trimmed);
    const pathMatch = pathRegex.exec(trimmed);

    if (urlMatch) {
      try {
        const u = new URL(urlMatch[0]);
        return { host: u.hostname, path: u.pathname || '/', status, size };
      } catch {
        return { host: '', path: '/', status, size };
      }
    }

    return { host: '', path: pathMatch ? pathMatch[0] : '/', status, size };
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLine)
    .filter(Boolean);
}

function parseWaybackUrls(body) {
  if (Array.isArray(body?.urls)) return body.urls.map((u) => String(u).trim()).filter(Boolean);

  const raw = String(body?.content || body?.raw || '').trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [...new Set(lines)];
}

function parseParamsPayload(body) {
  if (body?.groups && typeof body.groups === 'object') return body.groups;

  const raw = String(body?.content || body?.raw || '').trim();
  if (!raw) return {};

  const grouped = {};
  const addGroup = (endpoint, params) => {
    const key = String(endpoint || '').trim();
    if (!key) return;
    const clean = (params || []).map(String).map((p) => p.trim()).filter(Boolean);
    grouped[key] = [...new Set([...(grouped[key] || []), ...clean])];
  };

  const parseObjectLine = (trimmed) => {
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    const parsed = parseJsonSafe(trimmed, null);
    if (!parsed || typeof parsed !== 'object') return true;
    for (const [endpoint, params] of Object.entries(parsed)) {
      addGroup(endpoint, Array.isArray(params) ? params : []);
    }
    return true;
  };

  const parseUrlLine = (trimmed) => {
    if (!/^https?:\/\//i.test(trimmed)) return false;
    try {
      const u = new URL(trimmed);
      addGroup(`${u.hostname.toLowerCase()}${u.pathname || '/'}`, [...u.searchParams.keys()]);
    } catch {
      // ignore malformed URL line
    }
    return true;
  };

  const parseColonLine = (trimmed) => {
    const pair = trimmed.split(':');
    if (pair.length < 2) return;
    const endpoint = pair[0].trim();
    const params = pair.slice(1).join(':').split(',').map((p) => p.trim()).filter(Boolean);
    addGroup(endpoint, params);
  };

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (parseObjectLine(trimmed)) continue;
    if (parseUrlLine(trimmed)) continue;
    parseColonLine(trimmed);
  }

  return grouped;
}

function techListFromRecord(record) {
  if (Array.isArray(record.tech)) return record.tech;
  if (typeof record.tech === 'string') {
    return record.tech.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function mergeHttpxIntoSubdomain(existing, record, parsedUrl) {
  const incomingTech = techListFromRecord(record);
  const incomingPort = Number(record.port) || null;

  return {
    ...existing,
    url: parsedUrl.normalized,
    status: Number(record.status_code ?? record.status ?? record['status-code']) || null,
    title: String(record.title || ''),
    tech: [...new Set([...(Array.isArray(existing.tech) ? existing.tech : []), ...incomingTech])],
    ip: String(record.ip || ''),
    tls: record.tls || null,
    ports: [...new Set([...(Array.isArray(existing.ports) ? existing.ports : []), ...(incomingPort ? [incomingPort] : [])])],
  };
}

function parseParamEndpoint(endpointKey, targetValue) {
  let host = normalizeHostLikeValue(targetValue);
  let endpoint = endpointKey;

  if (/^https?:\/\//i.test(endpointKey)) {
    const parsed = parseHostAndPath(endpointKey, host);
    return { host: parsed.host, endpoint: parsed.path };
  }

  if (endpointKey.includes('/')) {
    const maybeHost = endpointKey.split('/')[0];
    if (maybeHost.includes('.')) host = normalizeHostLikeValue(maybeHost);
    endpoint = endpointKey.includes('/') ? `/${endpointKey.split('/').slice(1).join('/')}` : endpointKey;
  }

  return { host, endpoint };
}

function mergeParamsData(existing, endpoint, params) {
  const map = new Map(existing.map((e) => [e.endpoint, new Set(e.params || [])]));
  if (!map.has(endpoint)) map.set(endpoint, new Set());
  for (const p of params) map.get(endpoint).add(String(p));
  return [...map.entries()].map(([ep, set]) => ({ endpoint: ep, params: [...set].sort(alphaSort) }));
}

function aggregateParamsFromSubdomainRows(rows) {
  const grouped = new Map();

  const add = (endpoint, value) => {
    if (!grouped.has(endpoint)) grouped.set(endpoint, new Set());
    grouped.get(endpoint).add(String(value));
  };

  for (const row of rows) {
    const paramsData = parseJsonSafe(row.params_data || '[]', []);
    for (const item of paramsData) {
      const endpoint = item.endpoint || '/';
      for (const p of item.params || []) add(endpoint, p);
    }

    const wb = parseJsonSafe(row.wayback_data || '[]', []);
    for (const item of wb) {
      const endpoint = item.path || '/';
      for (const p of item.params || []) add(endpoint, p);
    }
  }

  return [...grouped.entries()]
    .map(([endpoint, set]) => ({ endpoint, params: [...set].sort(alphaSort) }))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

function parseHostAndPath(urlValue, fallbackHost) {
  try {
    const u = new URL(urlValue);
    return {
      host: u.hostname.toLowerCase(),
      path: u.pathname || '/',
      params: [...u.searchParams.keys()],
      normalized: normalizeUrl(urlValue),
    };
  } catch {
    return {
      host: fallbackHost,
      path: '/',
      params: [],
      normalized: String(urlValue || '').trim(),
    };
  }
}

router.post('/start', (req, res) => {
  const { target_id } = req.body;

  if (!target_id) {
    return res.status(400).json({ error: 'target_id required' });
  }

  const db = getDb();
  try {
    const target = db.prepare('SELECT id, workspace_id FROM targets WHERE id = ?').get(target_id);
    if (!target) {
      return res.status(404).json({ error: 'Target not found' });
    }

    const inProgress = db.prepare(`
      SELECT id FROM jobs
      WHERE target_id = ?
        AND status IN ('pending', 'running')
      LIMIT 1
    `).get(target.id);

    if (inProgress) {
      return res.status(409).json({ error: 'Recon already in progress for this target' });
    }

    const tools = ['subfinder', 'assetfinder'];
    if (isToolAvailable('chaos')) {
      tools.push('chaos');
    }

    const insertJob = db.prepare(`
      INSERT INTO jobs (workspace_id, target_id, tool, status)
      VALUES (?, ?, ?, 'pending')
    `);

    const tx = db.transaction((toolList) => {
      for (const tool of toolList) {
        insertJob.run(target.workspace_id, target.id, tool);
      }
    });

    tx(tools);

    res.status(201).json({
      message: 'Recon started',
      jobs_created: tools.length,
    });
  } finally {
    db.close();
  }
});

router.post('/import/httpx', (req, res) => {
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const records = parseHttpxPayload(req.body);
    let updated = 0;

    for (const record of records) {
      const rawUrl = record.url || record.final_url || record.input || '';
      const parsed = parseHostAndPath(rawUrl, normalizeHostLikeValue(target.value));
      const row = upsertSubdomainForTarget(db, target, parsed.host);
      if (!row) continue;

      const existing = parseJsonSafe(row.httpx_data || '{}', {});
      const merged = mergeHttpxIntoSubdomain(existing, record, parsed);

      db.prepare('UPDATE subdomains SET httpx_data=? WHERE id=?').run(JSON.stringify(merged), row.id);
      updated += 1;
    }

    res.json({ success: true, imported: updated, total_records: records.length });
  } finally {
    db.close();
  }
});

router.post('/import/dirsearch', (req, res) => {
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const entries = parseDirsearchPayload(req.body);
    let updated = 0;

    for (const item of entries) {
      const host = item.host || normalizeHostLikeValue(target.value);
      const row = upsertSubdomainForTarget(db, target, host);
      if (!row) continue;

      const existing = parseJsonSafe(row.dirsearch_data || '[]', []);
      const merged = mergeUniqueByKey([...existing, { path: item.path, status: item.status, size: item.size }], (v) => `${v.path}:${v.status}:${v.size}`);
      db.prepare('UPDATE subdomains SET dirsearch_data=? WHERE id=?').run(JSON.stringify(merged), row.id);
      updated += 1;
    }

    res.json({ success: true, imported: updated, total_records: entries.length });
  } finally {
    db.close();
  }
});

router.post('/import/wayback', (req, res) => {
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const urls = parseWaybackUrls(req.body);
    let updated = 0;

    for (const url of urls) {
      const parsed = parseHostAndPath(url, normalizeHostLikeValue(target.value));
      const row = upsertSubdomainForTarget(db, target, parsed.host);
      if (!row) continue;

      const entry = {
        url: parsed.normalized,
        path: parsed.path,
        has_params: parsed.params.length > 0,
        params: parsed.params,
      };

      const existing = parseJsonSafe(row.wayback_data || '[]', []);
      const merged = mergeUniqueByKey([...existing, entry], (v) => v.url);
      db.prepare('UPDATE subdomains SET wayback_data=? WHERE id=?').run(JSON.stringify(merged), row.id);
      updated += 1;
    }

    res.json({ success: true, imported: updated, total_records: urls.length });
  } finally {
    db.close();
  }
});

router.post('/import/params', (req, res) => {
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const groups = parseParamsPayload(req.body);
    let updated = 0;

    for (const [endpointKey, params] of Object.entries(groups)) {
      const parsedEndpoint = parseParamEndpoint(endpointKey, target.value);
      const host = parsedEndpoint.host;
      const endpoint = parsedEndpoint.endpoint;

      const row = upsertSubdomainForTarget(db, target, host);
      if (!row) continue;

      const existing = parseJsonSafe(row.params_data || '[]', []);
      const merged = mergeParamsData(existing, endpoint, params);
      db.prepare('UPDATE subdomains SET params_data=? WHERE id=?').run(JSON.stringify(merged), row.id);
      updated += 1;
    }

    res.json({ success: true, imported: updated, endpoints: Object.keys(groups).length });
  } finally {
    db.close();
  }
});

router.get('/intelligence/params', (req, res) => {
  const { target_id } = req.query;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const rows = db.prepare('SELECT params_data, wayback_data FROM subdomains WHERE target_id = ?').all(target_id);
    const endpoints = aggregateParamsFromSubdomainRows(rows);

    res.json({ target_id: Number(target_id), total: endpoints.length, endpoints });
  } finally {
    db.close();
  }
});

module.exports = router;
