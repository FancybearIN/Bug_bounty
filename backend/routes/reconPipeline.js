const express = require('express');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb } = require('../db/init');

const router = express.Router();

const ALIVE_CODES = new Set([200, 301, 302]);
const ALLOWED_DISCOVERY_TOOLS = new Set(['subfinder', 'assetfinder', 'chaos', 'amass']);

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
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(String(value || '').toLowerCase());
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isToolAvailable(tool) {
  const result = spawnSync(tool, ['-h'], { stdio: 'ignore', timeout: 2500 });
  return result.error?.code !== 'ENOENT';
}

function runTool(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`Tool not installed: ${tool}`);
    }
    throw new Error(result.error.message || `Failed to run ${tool}`);
  }

  if (result.status !== 0) {
    const err = String(result.stderr || '').trim();
    throw new Error(err || `${tool} exited with code ${result.status}`);
  }

  return String(result.stdout || '');
}

function parseDomainLines(output, domainSuffix) {
  const out = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const host = normalizeHostLikeValue(line);
    if (!host || !isValidDomain(host)) continue;
    if (domainSuffix && host !== domainSuffix && !host.endsWith(`.${domainSuffix}`)) continue;
    out.add(host);
  }
  return [...out];
}

function getTarget(db, targetId) {
  return db.prepare('SELECT id, workspace_id, value, is_active FROM targets WHERE id=?').get(targetId) || null;
}

function getSubdomain(db, subdomainId) {
  return db.prepare('SELECT id, workspace_id, target_id, value, httpx_data, dirsearch_data, wayback_data, params_data, discovery_source FROM subdomains WHERE id=?').get(subdomainId) || null;
}

function isTargetAllowedByActiveScope(db, target) {
  const rows = db.prepare(`
    SELECT value
    FROM scope_entries
    WHERE workspace_id=? AND is_active=1 AND type IN ('domain','wildcard')
  `).all(target.workspace_id);

  const t = normalizeHostLikeValue(target.value);
  for (const row of rows) {
    const scoped = normalizeHostLikeValue(String(row.value || '').replace(/^\*\./, ''));
    if (!scoped) continue;
    if (t === scoped || t.endsWith(`.${scoped}`)) return true;
  }
  return false;
}

function createJob(db, payload) {
  const r = db.prepare(`
    INSERT INTO jobs (workspace_id, target_id, subdomain_id, tool, status, logs, started_at)
    VALUES (?, ?, ?, ?, 'running', '', datetime('now'))
  `).run(payload.workspace_id, payload.target_id, payload.subdomain_id || null, payload.tool);
  return Number(r.lastInsertRowid);
}

function appendJobLog(db, jobId, message) {
  db.prepare("UPDATE jobs SET logs = COALESCE(logs,'') || ? || char(10) WHERE id=?").run(String(message || ''), jobId);
}

function completeJob(db, jobId, status, output = '') {
  db.prepare('UPDATE jobs SET status=?, output=?, finished_at=datetime(\'now\') WHERE id=?')
    .run(status, output, jobId);
}

function mergeDiscoverySource(existingRaw, toolName) {
  const existing = safeJsonParse(existingRaw || '[]', []);
  const set = new Set(Array.isArray(existing) ? existing.map(String) : []);
  set.add(String(toolName));
  return JSON.stringify([...set]);
}

function upsertDiscoveredSubdomain(db, target, host, toolName) {
  db.prepare(`
    INSERT INTO subdomains (workspace_id, target_id, value, discovery_source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, value) DO UPDATE SET
      target_id = COALESCE(subdomains.target_id, excluded.target_id),
      discovery_source = ?
  `).run(
    target.workspace_id,
    target.id,
    host,
    JSON.stringify([toolName]),
    mergeDiscoverySource(
      db.prepare('SELECT discovery_source FROM subdomains WHERE workspace_id=? AND value=?').get(target.workspace_id, host)?.discovery_source || '[]',
      toolName
    )
  );

  return db.prepare('SELECT * FROM subdomains WHERE workspace_id=? AND value=?').get(target.workspace_id, host);
}

function getDiscoveryCommand(tool, targetValue) {
  if (tool === 'subfinder') return { bin: 'subfinder', args: ['-d', targetValue, '-silent'] };
  if (tool === 'assetfinder') return { bin: 'assetfinder', args: ['--subs-only', targetValue] };
  if (tool === 'chaos') return { bin: 'chaos', args: ['-d', targetValue] };
  if (tool === 'amass') return { bin: 'amass', args: ['enum', '-passive', '-d', targetValue] };
  return null;
}

function parseHttpxLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const rawUrl = data.url || data.final_url || data.input || '';
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const status = Number(data.status_code ?? data.status ?? data['status-code']);
  const techRaw = data.tech || data.technologies || [];
  const tech = Array.isArray(techRaw)
    ? techRaw.map(String).filter(Boolean)
    : String(techRaw || '').split(',').map((v) => v.trim()).filter(Boolean);

  let resolvedPort = Number(data.port);
  if (!resolvedPort) {
    if (parsed.port) resolvedPort = Number(parsed.port);
    else resolvedPort = parsed.protocol === 'https:' ? 443 : 80;
  }

  return {
    host: parsed.hostname.toLowerCase(),
    status: Number.isNaN(status) ? null : status,
    title: String(data.title || ''),
    tech,
    ip: String(data.ip || ''),
    port: resolvedPort,
    server: String(data.server || data.webserver || ''),
  };
}

function parseDirsearchOutput(raw, host) {
  const rows = [];
  const statusRegex = /\b(200|201|204|301|302|307|308|401|403|405|500)\b/;
  const pathRegex = /\s(\/\S*)/;
  const sizeRegex = /\b(\d+)\b(?!.*\b\d+\b)/;
  for (const line of String(raw || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;

    const sm = statusRegex.exec(text);
    if (!sm) continue;

    const pathMatch = pathRegex.exec(text);
    const sizeMatch = sizeRegex.exec(text);

    rows.push({
      path: pathMatch ? pathMatch[1] : '/',
      status: Number(sm[1]),
      size: sizeMatch ? Number(sizeMatch[1]) : 0,
      host,
    });
  }
  return rows;
}

function parseWaybackOutput(raw) {
  const out = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const url = line.trim();
    if (!url.startsWith('http')) continue;
    try {
      const u = new URL(url);
      out.push({
        url,
        path: u.pathname || '/',
        has_params: [...u.searchParams.keys()].length > 0,
        params: [...new Set([...u.searchParams.keys()].map(String))],
      });
    } catch {
      // ignore malformed URL
    }
  }

  const dedupe = new Map();
  for (const item of out) dedupe.set(item.url, item);
  return [...dedupe.values()];
}

function mergeUniqueEntries(existing, incoming, keyFn) {
  const map = new Map();
  for (const item of existing || []) map.set(keyFn(item), item);
  for (const item of incoming || []) map.set(keyFn(item), item);
  return [...map.values()];
}

function upsertToolSetting(db, workspaceId, tool, enabled, config) {
  db.prepare(`
    INSERT INTO tool_settings (workspace_id, tool, enabled, config)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, tool) DO UPDATE SET
      enabled=excluded.enabled,
      config=excluded.config
  `).run(workspaceId, tool, enabled ? 1 : 0, JSON.stringify(config || {}));
}

router.post('/subdomain-discovery', (req, res) => {
  const { target_id, tools } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const selectedTools = Array.isArray(tools) && tools.length
    ? tools.map((t) => String(t).trim().toLowerCase()).filter((t) => ALLOWED_DISCOVERY_TOOLS.has(t))
    : ['subfinder', 'assetfinder', 'chaos'];

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    if (!isTargetAllowedByActiveScope(db, target)) {
      return res.status(400).json({ error: 'Target is not in ACTIVE scope' });
    }

    const jobId = createJob(db, {
      workspace_id: target.workspace_id,
      target_id: target.id,
      tool: 'subdomain-discovery',
    });

    let totalInserted = 0;
    const perTool = [];

    for (const tool of selectedTools) {
      const cmd = getDiscoveryCommand(tool, target.value);
      if (!cmd) continue;

      if (!isToolAvailable(cmd.bin)) {
        appendJobLog(db, jobId, `[${tool}] missing`);
        perTool.push({ tool, status: 'missing', found: 0, inserted: 0 });
        continue;
      }

      try {
        appendJobLog(db, jobId, `[${tool}] running`);
        const output = runTool(cmd.bin, cmd.args);
        const domains = parseDomainLines(output, normalizeHostLikeValue(target.value));
        let inserted = 0;
        for (const host of domains) {
          const before = db.prepare('SELECT id FROM subdomains WHERE workspace_id=? AND value=?').get(target.workspace_id, host);
          upsertDiscoveredSubdomain(db, target, host, tool);
          if (!before) inserted += 1;
        }

        totalInserted += inserted;
        appendJobLog(db, jobId, `[${tool}] found=${domains.length} inserted=${inserted}`);
        perTool.push({ tool, status: 'completed', found: domains.length, inserted });
      } catch (err) {
        appendJobLog(db, jobId, `[${tool}] failed: ${err.message}`);
        perTool.push({ tool, status: 'failed', found: 0, inserted: 0, error: err.message });
      }
    }

    completeJob(db, jobId, 'completed', JSON.stringify({ tools: perTool, inserted: totalInserted }));

    res.json({ success: true, target_id: Number(target_id), inserted: totalInserted, tools: perTool, job_id: jobId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Discovery pipeline failed' });
  } finally {
    db.close();
  }
});

router.post('/httpx', (req, res) => {
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });
    if (!isTargetAllowedByActiveScope(db, target)) {
      return res.status(400).json({ error: 'Target is not in ACTIVE scope' });
    }

    if (!isToolAvailable('httpx')) return res.status(400).json({ error: 'httpx is not installed' });

    const rows = db.prepare('SELECT id, value, httpx_data FROM subdomains WHERE target_id=?').all(target.id);
    if (!rows.length) return res.json({ success: true, scanned: 0, alive: 0, updated: 0 });

    const input = path.join(os.tmpdir(), `bb-httpx-${target.id}-${Date.now()}.txt`);
    fs.writeFileSync(input, `${rows.map((r) => r.value).join('\n')}\n`, 'utf8');

    const jobId = createJob(db, {
      workspace_id: target.workspace_id,
      target_id: target.id,
      tool: 'httpx',
    });

    let output = '';
    try {
      output = runTool('httpx', ['-l', input, '-json', '-silent', '-follow-redirects', '-random-agent']);
    } finally {
      try { fs.unlinkSync(input); } catch {}
    }

    const parsedByHost = new Map();
    for (const line of output.split(/\r?\n/)) {
      const parsed = parseHttpxLine(line);
      if (!parsed) continue;
      parsedByHost.set(parsed.host, parsed);
    }

    let updated = 0;
    let alive = 0;

    for (const row of rows) {
      const hit = parsedByHost.get(String(row.value || '').toLowerCase());
      if (!hit) {
        db.prepare('UPDATE subdomains SET is_alive=0 WHERE id=?').run(row.id);
        continue;
      }

      const existing = safeJsonParse(row.httpx_data || '{}', {});
      const merged = {
        ...existing,
        status: hit.status,
        title: hit.title,
        tech: [...new Set([...(Array.isArray(existing.tech) ? existing.tech : []), ...hit.tech])],
        ip: hit.ip,
        port: hit.port,
        server: hit.server,
      };

      const isAlive = hit.status && ALIVE_CODES.has(hit.status) ? 1 : 0;
      if (isAlive) alive += 1;
      db.prepare('UPDATE subdomains SET httpx_data=?, is_alive=? WHERE id=?')
        .run(JSON.stringify(merged), isAlive, row.id);
      updated += 1;
    }

    appendJobLog(db, jobId, `[httpx] scanned=${rows.length} updated=${updated} alive=${alive}`);
    completeJob(db, jobId, 'completed', output);

    res.json({ success: true, scanned: rows.length, updated, alive, job_id: jobId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'HTTPX pipeline failed' });
  } finally {
    db.close();
  }
});

router.post('/promote-alive', (req, res) => {
  const { target_id } = req.body;
  if (!target_id) return res.status(400).json({ error: 'target_id required' });

  const db = getDb();
  try {
    const target = getTarget(db, target_id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const rows = db.prepare('SELECT id, httpx_data FROM subdomains WHERE target_id=?').all(target.id);
    let promoted = 0;
    for (const row of rows) {
      const status = Number(safeJsonParse(row.httpx_data || '{}', {}).status);
      if (!ALIVE_CODES.has(status)) continue;
      db.prepare('UPDATE subdomains SET is_active=1, is_alive=1 WHERE id=?').run(row.id);
      promoted += 1;
    }

    res.json({ success: true, target_id: Number(target_id), promoted });
  } finally {
    db.close();
  }
});

router.post('/dirsearch', (req, res) => {
  const { subdomain_id } = req.body;
  if (!subdomain_id) return res.status(400).json({ error: 'subdomain_id required' });

  const db = getDb();
  try {
    const sd = getSubdomain(db, subdomain_id);
    if (!sd) return res.status(404).json({ error: 'Subdomain not found' });

    const targetId = sd.target_id || db.prepare("SELECT id FROM targets WHERE workspace_id=? AND type='domain' AND value=?").get(sd.workspace_id, sd.value)?.id;
    if (!targetId) return res.status(400).json({ error: 'Target mapping missing for subdomain' });

    const jobId = createJob(db, {
      workspace_id: sd.workspace_id,
      target_id: targetId,
      subdomain_id: sd.id,
      tool: 'dirsearch',
    });

    if (!isToolAvailable('dirsearch')) {
      completeJob(db, jobId, 'failed', 'dirsearch not installed');
      return res.status(400).json({ error: 'dirsearch is not installed', job_id: jobId });
    }

    const settings = db.prepare('SELECT enabled, config FROM tool_settings WHERE workspace_id=? AND tool=?').get(sd.workspace_id, 'dirsearch');
    if (settings && Number(settings.enabled) === 0) {
      completeJob(db, jobId, 'failed', 'dirsearch disabled in tool settings');
      return res.status(400).json({ error: 'dirsearch is disabled in this workspace', job_id: jobId });
    }

    const cfg = safeJsonParse(settings?.config || '{}', {});
    const threads = Number(cfg.threads) > 0 ? String(Number(cfg.threads)) : '20';
    const wordlist = cfg.wordlist ? String(cfg.wordlist) : null;
    const rateLimit = Number(cfg.rate_limit) > 0 ? String(Number(cfg.rate_limit)) : null;

    const args = ['-u', `https://${sd.value}`, '--plain-text-report=-', '--threads', threads, '-q'];
    if (wordlist) args.push('-w', wordlist);
    if (rateLimit) args.push('--max-rate', rateLimit);

    const output = runTool('dirsearch', args);
    const parsed = parseDirsearchOutput(output, sd.value);

    const existing = safeJsonParse(sd.dirsearch_data || '[]', []);
    const merged = mergeUniqueEntries(existing, parsed.map((d) => ({ path: d.path, status: d.status, size: d.size })), (d) => `${d.path}:${d.status}:${d.size}`);
    db.prepare('UPDATE subdomains SET dirsearch_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);

    appendJobLog(db, jobId, `[dirsearch] matches=${parsed.length}`);
    completeJob(db, jobId, 'completed', output);

    res.json({ success: true, subdomain_id: Number(subdomain_id), imported: parsed.length, job_id: jobId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Dirsearch execution failed' });
  } finally {
    db.close();
  }
});

router.post('/wayback', (req, res) => {
  const { subdomain_id } = req.body;
  if (!subdomain_id) return res.status(400).json({ error: 'subdomain_id required' });

  const db = getDb();
  try {
    const sd = getSubdomain(db, subdomain_id);
    if (!sd) return res.status(404).json({ error: 'Subdomain not found' });

    const targetId = sd.target_id || db.prepare("SELECT id FROM targets WHERE workspace_id=? AND type='domain' AND value=?").get(sd.workspace_id, sd.value)?.id;
    if (!targetId) return res.status(400).json({ error: 'Target mapping missing for subdomain' });

    const jobId = createJob(db, {
      workspace_id: sd.workspace_id,
      target_id: targetId,
      subdomain_id: sd.id,
      tool: 'waybackurls',
    });

    if (!isToolAvailable('waybackurls')) {
      completeJob(db, jobId, 'failed', 'waybackurls not installed');
      return res.status(400).json({ error: 'waybackurls is not installed', job_id: jobId });
    }

    const output = runTool('waybackurls', [sd.value]);
    const parsed = parseWaybackOutput(output);

    const existing = safeJsonParse(sd.wayback_data || '[]', []);
    const merged = mergeUniqueEntries(existing, parsed, (d) => d.url);

    db.prepare('UPDATE subdomains SET wayback_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);

    appendJobLog(db, jobId, `[waybackurls] urls=${parsed.length}`);
    completeJob(db, jobId, 'completed', output);

    res.json({ success: true, subdomain_id: Number(subdomain_id), imported: parsed.length, job_id: jobId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Wayback execution failed' });
  } finally {
    db.close();
  }
});

router.post('/params', (req, res) => {
  const { subdomain_id } = req.body;
  if (!subdomain_id) return res.status(400).json({ error: 'subdomain_id required' });

  const db = getDb();
  try {
    const sd = getSubdomain(db, subdomain_id);
    if (!sd) return res.status(404).json({ error: 'Subdomain not found' });

    const targetId = sd.target_id || db.prepare("SELECT id FROM targets WHERE workspace_id=? AND type='domain' AND value=?").get(sd.workspace_id, sd.value)?.id;
    if (!targetId) return res.status(400).json({ error: 'Target mapping missing for subdomain' });

    const jobId = createJob(db, {
      workspace_id: sd.workspace_id,
      target_id: targetId,
      subdomain_id: sd.id,
      tool: 'params',
    });

    let output = '';
    if (isToolAvailable('waybackurls')) {
      output = runTool('waybackurls', [sd.value]);
    } else {
      completeJob(db, jobId, 'failed', 'No supported parameter source installed (waybackurls missing)');
      return res.status(400).json({ error: 'No supported parameter source installed', job_id: jobId });
    }

    const paramsByEndpoint = new Map();
    const parsedUrls = parseWaybackOutput(output);
    for (const item of parsedUrls) {
      if (!item.has_params || !item.params.length) continue;
      const key = item.path || '/';
      if (!paramsByEndpoint.has(key)) paramsByEndpoint.set(key, new Set());
      for (const p of item.params) paramsByEndpoint.get(key).add(String(p));
    }

    const discovered = [...paramsByEndpoint.entries()].map(([endpoint, set]) => ({
      endpoint,
      method: ['GET'],
      params: [...set].sort((a, b) => a.localeCompare(b)),
    }));

    const existing = safeJsonParse(sd.params_data || '[]', []);
    const mergedMap = new Map();
    for (const item of existing) {
      const key = String(item.endpoint || '/');
      const methods = new Set(Array.isArray(item.method) ? item.method.map(String) : ['GET']);
      const params = new Set(Array.isArray(item.params) ? item.params.map(String) : []);
      mergedMap.set(key, { endpoint: key, method: methods, params });
    }

    for (const item of discovered) {
      const key = item.endpoint;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, { endpoint: key, method: new Set(), params: new Set() });
      }
      const row = mergedMap.get(key);
      for (const m of item.method) row.method.add(String(m));
      for (const p of item.params) row.params.add(String(p));
    }

    const merged = [...mergedMap.values()].map((v) => ({
      endpoint: v.endpoint,
      method: [...v.method].sort((a, b) => a.localeCompare(b)),
      params: [...v.params].sort((a, b) => a.localeCompare(b)),
    }));

    db.prepare('UPDATE subdomains SET params_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);

    appendJobLog(db, jobId, `[params] endpoints=${discovered.length}`);
    completeJob(db, jobId, 'completed', output);

    res.json({ success: true, subdomain_id: Number(subdomain_id), endpoints: discovered.length, job_id: jobId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Params execution failed' });
  } finally {
    db.close();
  }
});

router.post('/run-all-tools', (req, res) => {
  const { subdomain_id, tools } = req.body;
  if (!subdomain_id) return res.status(400).json({ error: 'subdomain_id required' });

  const selected = Array.isArray(tools) && tools.length
    ? tools.map((t) => String(t).toLowerCase())
    : ['dirsearch', 'wayback', 'params'];

  const db = getDb();
  try {
    const sd = getSubdomain(db, subdomain_id);
    if (!sd) return res.status(404).json({ error: 'Subdomain not found' });

    const createdJobs = [];
    const targetId = sd.target_id || db.prepare("SELECT id FROM targets WHERE workspace_id=? AND type='domain' AND value=?").get(sd.workspace_id, sd.value)?.id;
    if (!targetId) return res.status(400).json({ error: 'Target mapping missing for subdomain' });

    for (const tool of selected) {
      if (!['dirsearch', 'wayback', 'params'].includes(tool)) continue;
      const mappedTool = tool === 'wayback' ? 'waybackurls' : tool;
      const r = db.prepare(`
        INSERT INTO jobs (workspace_id, target_id, subdomain_id, tool, status)
        VALUES (?, ?, ?, ?, 'pending')
      `).run(sd.workspace_id, targetId, sd.id, mappedTool);
      createdJobs.push(Number(r.lastInsertRowid));
    }

    res.json({ success: true, subdomain_id: Number(subdomain_id), jobs_created: createdJobs.length, job_ids: createdJobs });
  } finally {
    db.close();
  }
});

router.post('/params/manual', (req, res) => {
  const { subdomain_id, endpoint, method, params } = req.body;
  if (!subdomain_id || !endpoint) return res.status(400).json({ error: 'subdomain_id and endpoint required' });

  const methods = Array.isArray(method)
    ? method.map((m) => String(m).trim().toUpperCase()).filter(Boolean)
    : String(method || 'GET').split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);
  const cleanParams = Array.isArray(params)
    ? params.map((p) => String(p).trim()).filter(Boolean)
    : String(params || '').split(',').map((p) => p.trim()).filter(Boolean);

  const db = getDb();
  try {
    const sd = getSubdomain(db, subdomain_id);
    if (!sd) return res.status(404).json({ error: 'Subdomain not found' });

    const existing = safeJsonParse(sd.params_data || '[]', []);
    const byEndpoint = new Map();
    for (const item of existing) {
      byEndpoint.set(String(item.endpoint || '/'), {
        endpoint: String(item.endpoint || '/'),
        method: new Set(Array.isArray(item.method) ? item.method.map(String) : ['GET']),
        params: new Set(Array.isArray(item.params) ? item.params.map(String) : []),
      });
    }

    const key = String(endpoint).trim() || '/';
    if (!byEndpoint.has(key)) {
      byEndpoint.set(key, { endpoint: key, method: new Set(), params: new Set() });
    }

    const row = byEndpoint.get(key);
    for (const m of methods) row.method.add(m);
    for (const p of cleanParams) row.params.add(p);

    const merged = [...byEndpoint.values()].map((v) => ({
      endpoint: v.endpoint,
      method: [...v.method].sort((a, b) => a.localeCompare(b)),
      params: [...v.params].sort((a, b) => a.localeCompare(b)),
    }));

    db.prepare('UPDATE subdomains SET params_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);

    res.json({ success: true, subdomain_id: Number(subdomain_id), total_endpoints: merged.length });
  } finally {
    db.close();
  }
});

router.get('/flow', (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  const db = getDb();
  try {
    const scope = db.prepare('SELECT COUNT(*) AS count FROM scope_entries WHERE workspace_id=? AND is_active=1').get(workspace_id).count;
    const subdomains = db.prepare('SELECT COUNT(*) AS count FROM subdomains WHERE workspace_id=?').get(workspace_id).count;
    const alive = db.prepare('SELECT COUNT(*) AS count FROM subdomains WHERE workspace_id=? AND is_alive=1').get(workspace_id).count;
    const tested = db.prepare(`
      SELECT COUNT(*) AS count
      FROM subdomains
      WHERE workspace_id=?
        AND (
          length(trim(COALESCE(dirsearch_data, '[]'))) > 2
          OR length(trim(COALESCE(wayback_data, '[]'))) > 2
          OR length(trim(COALESCE(params_data, '[]'))) > 2
        )
    `).get(workspace_id).count;

    res.json({ workspace_id: Number(workspace_id), scope, subdomains, alive, tested });
  } finally {
    db.close();
  }
});

router.get('/auto-mode', (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  const db = getDb();
  try {
    const ws = db.prepare('SELECT id, auto_recon_mode FROM workspaces WHERE id=?').get(workspace_id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    res.json({ workspace_id: Number(workspace_id), enabled: Number(ws.auto_recon_mode) === 1 });
  } finally {
    db.close();
  }
});

router.patch('/auto-mode', (req, res) => {
  const { workspace_id, enabled } = req.body;
  if (!workspace_id || enabled === undefined) return res.status(400).json({ error: 'workspace_id and enabled required' });

  const db = getDb();
  try {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspace_id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    db.prepare('UPDATE workspaces SET auto_recon_mode=? WHERE id=?').run(enabled ? 1 : 0, workspace_id);
    res.json({ success: true, workspace_id: Number(workspace_id), enabled: !!enabled });
  } finally {
    db.close();
  }
});

router.get('/tool-settings', (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  const db = getDb();
  try {
    const rows = db.prepare('SELECT tool, enabled, config FROM tool_settings WHERE workspace_id=? ORDER BY tool ASC').all(workspace_id);
    res.json(rows.map((r) => ({ tool: r.tool, enabled: Number(r.enabled) === 1, config: safeJsonParse(r.config || '{}', {}) })));
  } finally {
    db.close();
  }
});

router.patch('/tool-settings', (req, res) => {
  const { workspace_id, tool, enabled, config } = req.body;
  if (!workspace_id || !tool) return res.status(400).json({ error: 'workspace_id and tool required' });

  const db = getDb();
  try {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspace_id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    upsertToolSetting(db, workspace_id, String(tool).toLowerCase(), enabled !== false, config || {});
    res.json({ success: true });
  } finally {
    db.close();
  }
});

module.exports = router;
