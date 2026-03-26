const { getDb } = require('../db/init');
const { execFile, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const POLL_INTERVAL_MS = 3000;
const TOOL_TIMEOUT_MS = 60 * 1000;
const HTTPX_BATCH_SIZE = 75;
const RECON_TOOL_TIMEOUT_MS = 5 * 60 * 1000;

let workerTimer = null;

function isToolAvailable(bin) {
  const result = spawnSync(bin, ['-h'], { stdio: 'ignore', timeout: 2500 });
  return result.error?.code !== 'ENOENT';
}

function runToolCommandLong(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: RECON_TOOL_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) {
        resolve((stdout || '').toString());
        return;
      }
      if (err.code === 'ENOENT') {
        reject(new Error(`tool not installed: ${bin}`));
        return;
      }
      const message = (stderr || err.message || '').toString().trim() || `tool execution failed: ${bin}`;
      reject(new Error(message));
    });
  });
}

function parseDirsearchLines(raw) {
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
    rows.push({ path: pathMatch ? pathMatch[1] : '/', status: Number(sm[1]), size: sizeMatch ? Number(sizeMatch[1]) : 0 });
  }
  return rows;
}

function parseWaybackLines(raw) {
  const out = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const url = line.trim();
    if (!url.startsWith('http')) continue;
    try {
      const u = new URL(url);
      out.push({ url, path: u.pathname || '/', has_params: [...u.searchParams.keys()].length > 0, params: [...new Set([...u.searchParams.keys()].map(String))] });
    } catch {}
  }
  const dedupe = new Map();
  for (const item of out) dedupe.set(item.url, item);
  return [...dedupe.values()];
}

function parseFfufJsonOutput(raw) {
  let data;
  try { data = JSON.parse(String(raw || '').trim()); } catch { return []; }
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => ({
    path: '/' + String((r.input && r.input.FUZZ) ? r.input.FUZZ : '').replace(/^\/+/, ''),
    status: Number(r.status) || 0,
    size: Number(r.length) || 0,
  })).filter((r) => r.status > 0);
}

function mergeUniqueByKey(existing, incoming, keyFn) {
  const map = new Map();
  for (const item of existing || []) map.set(keyFn(item), item);
  for (const item of incoming || []) map.set(keyFn(item), item);
  return [...map.values()];
}

async function runDirsearchJob(db, job) {
  const sd = db.prepare('SELECT id, workspace_id, target_id, value, dirsearch_data FROM subdomains WHERE id=?').get(job.subdomain_id);
  if (!sd) throw new Error('subdomain not found');
  if (!isValidDomain(sd.value)) throw new Error('invalid subdomain value');
  if (!isToolAvailable('dirsearch')) throw new Error('dirsearch not installed');

  const settings = db.prepare('SELECT enabled, config FROM tool_settings WHERE workspace_id=? AND tool=?').get(sd.workspace_id, 'dirsearch');
  if (settings && Number(settings.enabled) === 0) throw new Error('dirsearch disabled in tool settings');

  const cfg = safeParseJson(settings?.config || '{}', {});
  const threads = Number(cfg.threads) > 0 ? String(Number(cfg.threads)) : '20';
  const wordlist = cfg.wordlist ? String(cfg.wordlist) : null;
  const args = ['-u', `https://${sd.value}`, '--plain-text-report=-', '--threads', threads, '-q'];
  if (wordlist) args.push('-w', wordlist);
  if (Number(cfg.rate_limit) > 0) args.push('--max-rate', String(Number(cfg.rate_limit)));

  const output = await runToolCommandLong('dirsearch', args);
  const parsed = parseDirsearchLines(output);
  const existing = safeParseJson(sd.dirsearch_data || '[]', []);
  const merged = mergeUniqueByKey(existing, parsed.map((d) => ({ path: d.path, status: d.status, size: d.size })), (d) => `${d.path}:${d.status}:${d.size}`);
  db.prepare('UPDATE subdomains SET dirsearch_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);
  return { imported: parsed.length };
}

async function runWaybackJob(db, job) {
  const sd = db.prepare('SELECT id, workspace_id, target_id, value, wayback_data FROM subdomains WHERE id=?').get(job.subdomain_id);
  if (!sd) throw new Error('subdomain not found');
  if (!isValidDomain(sd.value)) throw new Error('invalid subdomain value');
  if (!isToolAvailable('waybackurls')) throw new Error('waybackurls not installed');

  const output = await runToolCommandLong('waybackurls', [sd.value]);
  const parsed = parseWaybackLines(output);
  const existing = safeParseJson(sd.wayback_data || '[]', []);
  const merged = mergeUniqueByKey(existing, parsed, (d) => d.url);
  db.prepare('UPDATE subdomains SET wayback_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);
  return { imported: parsed.length };
}

async function runParamsJob(db, job) {
  const sd = db.prepare('SELECT id, workspace_id, target_id, value, params_data FROM subdomains WHERE id=?').get(job.subdomain_id);
  if (!sd) throw new Error('subdomain not found');
  if (!isValidDomain(sd.value)) throw new Error('invalid subdomain value');
  if (!isToolAvailable('waybackurls')) throw new Error('waybackurls not installed (needed for params)');

  const output = await runToolCommandLong('waybackurls', [sd.value]);
  const parsedUrls = parseWaybackLines(output);

  const paramsByEndpoint = new Map();
  for (const item of parsedUrls) {
    if (!item.has_params || !item.params.length) continue;
    const key = item.path || '/';
    if (!paramsByEndpoint.has(key)) paramsByEndpoint.set(key, new Set());
    for (const p of item.params) paramsByEndpoint.get(key).add(String(p));
  }

  const discovered = [...paramsByEndpoint.entries()].map(([endpoint, set]) => ({ endpoint, method: ['GET'], params: [...set].sort((a, b) => a.localeCompare(b)) }));
  const existing = safeParseJson(sd.params_data || '[]', []);
  const mergedMap = new Map();
  for (const item of existing) {
    const key = String(item.endpoint || '/');
    mergedMap.set(key, { endpoint: key, method: new Set(Array.isArray(item.method) ? item.method.map(String) : ['GET']), params: new Set(Array.isArray(item.params) ? item.params.map(String) : []) });
  }
  for (const item of discovered) {
    const key = item.endpoint;
    if (!mergedMap.has(key)) mergedMap.set(key, { endpoint: key, method: new Set(), params: new Set() });
    const row = mergedMap.get(key);
    for (const m of item.method) row.method.add(String(m));
    for (const p of item.params) row.params.add(String(p));
  }
  const merged = [...mergedMap.values()].map((v) => ({ endpoint: v.endpoint, method: [...v.method].sort((a, b) => a.localeCompare(b)), params: [...v.params].sort((a, b) => a.localeCompare(b)) }));
  db.prepare('UPDATE subdomains SET params_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);
  return { endpoints: discovered.length };
}

async function runFfufJob(db, job) {
  const sd = db.prepare('SELECT id, workspace_id, target_id, value, dirsearch_data FROM subdomains WHERE id=?').get(job.subdomain_id);
  if (!sd) throw new Error('subdomain not found');
  if (!isValidDomain(sd.value)) throw new Error('invalid subdomain value');
  if (!isToolAvailable('ffuf')) throw new Error('ffuf not installed');

  const settings = db.prepare('SELECT enabled, config FROM tool_settings WHERE workspace_id=? AND tool=?').get(sd.workspace_id, 'ffuf');
  if (settings && Number(settings.enabled) === 0) throw new Error('ffuf disabled in tool settings');

  const cfg = safeParseJson(settings?.config || '{}', {});
  const threads = Number(cfg.threads) > 0 ? String(Number(cfg.threads)) : '40';
  const DEFAULT_WORDLIST = '/usr/share/wordlists/dirb/common.txt';
  let wordlist = cfg.wordlist ? String(cfg.wordlist) : null;
  if (!wordlist) {
    if (fs.existsSync(DEFAULT_WORDLIST)) {
      wordlist = DEFAULT_WORDLIST;
    } else {
      throw new Error('No wordlist configured for ffuf');
    }
  }

  const args = ['-u', `https://${sd.value}/FUZZ`, '-w', wordlist, '-json', '-mc', '200,201,204,301,302,307,401,403', '-t', threads];
  const extRaw = cfg.extensions ? String(cfg.extensions).trim() : '';
  if (extRaw) {
    const exts = extRaw.split(',').map((e) => e.trim()).filter(Boolean).map((e) => (e.startsWith('.') ? e : `.${e}`));
    if (exts.length) args.push('-e', exts.join(','));
  }

  const output = await runToolCommandLong('ffuf', args);
  const parsed = parseFfufJsonOutput(output);
  const existing = safeParseJson(sd.dirsearch_data || '[]', []);
  const merged = mergeUniqueByKey(existing, parsed, (d) => `${d.path}:${d.status}:${d.size}`);
  db.prepare('UPDATE subdomains SET dirsearch_data=? WHERE id=?').run(JSON.stringify(merged), sd.id);
  return { imported: parsed.length };
}

function runSubfinder(domain) {
  return runToolCommand('subfinder', ['-d', domain, '-silent']);
}

function runAssetfinder(domain) {
  return runToolCommand('assetfinder', ['--subs-only', domain]);
}

function runChaos(domain) {
  return runToolCommand('chaos', ['-d', domain]);
}

function runHttpxWithFile(inputFile) {
  return runToolCommand('httpx', [
    '-l', inputFile,
    '-json',
    '-silent',
    '-follow-redirects',
    '-random-agent',
  ]);
}

function runToolCommand(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TOOL_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) {
        resolve((stdout || '').toString());
        return;
      }

      if (err.code === 'ENOENT') {
        reject(new Error(`tool not installed: ${bin}`));
        return;
      }

      const message = (stderr || err.message || '').toString().trim() || `tool execution failed: ${bin}`;
      reject(new Error(message));
    });
  });
}

function normalizeDomain(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

function isValidDomain(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);
}

function parseSubdomainOutput(rawOutput) {
  const unique = new Set();
  const lines = (rawOutput || '').split(/\r?\n/);

  for (const line of lines) {
    const domain = normalizeDomain(line);
    if (!domain || !isValidDomain(domain)) continue;
    unique.add(domain);
  }

  return [...unique];
}

function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const cleanPort = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${cleanPort}`;
  } catch {
    return value.toLowerCase().replace(/\/$/, '');
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function parseUrlMeta(value) {
  try {
    const u = new URL(value);
    let port = 80;
    if (u.port) port = Number(u.port);
    else if (u.protocol === 'https:') port = 443;

    return {
      hostname: u.hostname.toLowerCase(),
      protocol: u.protocol.replace(':', ''),
      port,
      normalizedUrl: normalizeUrl(value),
    };
  } catch {
    return null;
  }
}

function parseHttpxJsonLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const rawUrl = obj.url || obj.final_url || obj.input || '';
  const urlMeta = parseUrlMeta(rawUrl);
  if (!urlMeta || !isValidDomain(urlMeta.hostname)) return null;

  const status = Number(obj.status_code ?? obj['status-code']);
  const tech = toArray(obj.tech || obj.technologies).map((t) => String(t).toLowerCase());
  const cnameValues = toArray(obj.cname).map((v) => String(v).toLowerCase());
  const redirect = obj.location || obj.redirect || obj.final_url || '';
  let cdnValue = '';
  if (typeof obj.cdn === 'string') cdnValue = obj.cdn;
  else if (obj.cdn_name) cdnValue = obj.cdn_name;
  else if (obj.cdn === true) cdnValue = 'true';

  return {
    domain: urlMeta.hostname,
    url: urlMeta.normalizedUrl,
    status: Number.isNaN(status) ? null : status,
    title: String(obj.title || ''),
    tech,
    server: String(obj.server || obj.webserver || ''),
    web_server: String(obj.webserver || ''),
    ip: String(obj.ip || ''),
    cdn: String(cdnValue || ''),
    redirect: redirect ? normalizeUrl(String(redirect)) : '',
    cname: cnameValues[0] || '',
    protocol: urlMeta.protocol,
    port: Number(obj.port) || urlMeta.port,
  };
}

function parseHttpxOutput(rawOutput) {
  const byDomain = new Map();
  const lines = (rawOutput || '').split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseHttpxJsonLine(line);
    if (!parsed) continue;
    byDomain.set(parsed.domain, parsed);
  }

  return byDomain;
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mergeString(oldValue, newValue) {
  return newValue || oldValue;
}

function mergeHttpxData(existing, incoming) {
  const existingObj = existing || {};
  const merged = { ...existingObj };

  merged.url = mergeString(existing?.url || '', incoming.url || '');
  merged.status = incoming.status ?? existing?.status ?? null;
  merged.title = mergeString(existing?.title || '', incoming.title || '');
  merged.server = mergeString(existing?.server || '', incoming.server || '');
  merged.web_server = mergeString(existing?.web_server || '', incoming.web_server || '');
  merged.ip = mergeString(existing?.ip || '', incoming.ip || '');
  merged.cdn = mergeString(existing?.cdn || '', incoming.cdn || '');
  merged.redirect = mergeString(existing?.redirect || '', incoming.redirect || '');
  merged.cname = mergeString(existing?.cname || '', incoming.cname || '');
  merged.protocol = mergeString(existing?.protocol || '', incoming.protocol || '');

  const oldPorts = Array.isArray(existing?.ports) ? existing.ports : [];
  const nextPort = incoming.port ? [incoming.port] : [];
  merged.ports = [...new Set([...oldPorts, ...nextPort])].filter((v) => Number.isInteger(v));

  const oldTech = Array.isArray(existing?.tech) ? existing.tech.map((t) => String(t).toLowerCase()) : [];
  const newTech = Array.isArray(incoming.tech) ? incoming.tech.map((t) => String(t).toLowerCase()) : [];
  merged.tech = [...new Set([...oldTech, ...newTech])];

  return merged;
}

function writeDomainsTempFile(domains) {
  const filePath = path.join(os.tmpdir(), `recon-httpx-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(filePath, `${domains.join('\n')}\n`, 'utf8');
  return filePath;
}

function chunkArray(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function getSubdomainsForTarget(db, job) {
  const cols = getSubdomainsTableColumns(db);
  if (cols.has('target_id')) {
    return db.prepare('SELECT id, value, httpx_data FROM subdomains WHERE target_id = ?').all(job.target_id);
  }
  return db.prepare('SELECT id, value, httpx_data FROM subdomains WHERE workspace_id = ?').all(job.workspace_id);
}

async function executeHttpxJob(db, job) {
  const rows = getSubdomainsForTarget(db, job);
  if (!rows.length) {
    return {
      rawOutput: '[httpx] no subdomains found for target',
      enriched: 0,
      scanned: 0,
    };
  }

  const byDomain = new Map();
  for (const row of rows) {
    byDomain.set(String(row.value || '').toLowerCase(), row);
  }

  const parsed = new Map();
  const rawOutputs = [];
  const batches = chunkArray([...byDomain.keys()], HTTPX_BATCH_SIZE);

  for (const batch of batches) {
    const inputFile = writeDomainsTempFile(batch);
    let rawOutput = '';
    try {
      rawOutput = await runHttpxWithFile(inputFile);
    } finally {
      try { fs.unlinkSync(inputFile); } catch {}
    }

    if (rawOutput) rawOutputs.push(rawOutput.trim());
    const parsedBatch = parseHttpxOutput(rawOutput);
    for (const [domain, entry] of parsedBatch.entries()) {
      parsed.set(domain, entry);
    }
  }

  const updateStmt = db.prepare('UPDATE subdomains SET httpx_data=?, is_alive=? WHERE id=?');

  let enriched = 0;
  for (const [domain, incoming] of parsed.entries()) {
    const row = byDomain.get(domain);
    if (!row) continue;
    const existing = safeParseJson(row.httpx_data || '{}', {});
    const merged = mergeHttpxData(existing, incoming);
    const statusCode = Number(merged.status);
    const isAlive = statusCode === 200 || statusCode === 301 || statusCode === 302 ? 1 : 0;
    updateStmt.run(JSON.stringify(merged), isAlive, row.id);
    enriched += 1;
  }

  return {
    rawOutput: rawOutputs.join('\n'),
    enriched,
    scanned: byDomain.size,
  };
}

function getSubdomainsTableColumns(db) {
  const cols = db.prepare('PRAGMA table_info(subdomains)').all();
  return new Set(cols.map((c) => c.name));
}

function saveSubdomains(db, job, subdomains) {
  if (!subdomains.length) return 0;

  const columns = getSubdomainsTableColumns(db);
  let stmt;

  if (columns.has('target_id')) {
    stmt = db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, target_id, value) VALUES (?,?,?)');
    let inserted = 0;
    for (const value of subdomains) {
      inserted += stmt.run(job.workspace_id, job.target_id, value).changes;
    }
    return inserted;
  }

  stmt = db.prepare('INSERT OR IGNORE INTO subdomains (workspace_id, value) VALUES (?,?)');
  let inserted = 0;
  for (const value of subdomains) {
    inserted += stmt.run(job.workspace_id, value).changes;
  }
  return inserted;
}

function getRunner(tool) {
  if (tool === 'subfinder') return runSubfinder;
  if (tool === 'assetfinder') return runAssetfinder;
  if (tool === 'chaos') return runChaos;
  return null;
}

function markJobFailed(jobId, message) {
  const db = getDb();
  try {
    db.prepare("UPDATE jobs SET status='failed', output=?, logs=COALESCE(logs,'') || ? || char(10), finished_at=datetime('now') WHERE id=?")
      .run(message, String(message || ''), jobId);
    db.prepare(`
      INSERT INTO job_results (job_id, stage, status, message, raw_output)
      VALUES (?, 'pipeline', 'failed', ?, ?)
    `).run(jobId, message, message);
  } finally {
    db.close();
  }
}

function logJobResult(db, jobId, stage, status, message, rawOutput = '') {
  db.prepare("UPDATE jobs SET logs = COALESCE(logs,'') || ? || char(10) WHERE id=?")
    .run(`[${stage}] ${status} ${message || ''}`.trim(), jobId);
  db.prepare(`
    INSERT INTO job_results (job_id, stage, status, message, raw_output)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, stage, status, message || '', rawOutput || '');
}

async function executeJob(job) {
  const db = getDb();
  try {
    logJobResult(db, job.id, 'pipeline', 'running', 'Job claimed by worker');

    const target = db.prepare('SELECT value FROM targets WHERE id = ?').get(job.target_id);
    if (!target) throw new Error('target not found');

    if (['dirsearch', 'waybackurls', 'params', 'ffuf'].includes(job.tool) && job.subdomain_id) {
      logJobResult(db, job.id, 'run_tool', 'running', `Running ${job.tool} for subdomain ${job.subdomain_id}`);
      let result;
      if (job.tool === 'dirsearch') result = await runDirsearchJob(db, job);
      else if (job.tool === 'waybackurls') result = await runWaybackJob(db, job);
      else if (job.tool === 'params') result = await runParamsJob(db, job);
      else if (job.tool === 'ffuf') result = await runFfufJob(db, job);
      const output = `tool=${job.tool}\nsubdomain_id=${job.subdomain_id}\n${JSON.stringify(result)}`;
      db.prepare("UPDATE jobs SET status='completed', output=?, finished_at=datetime('now') WHERE id=?").run(output, job.id);
      logJobResult(db, job.id, 'pipeline', 'completed', 'Job completed', output);
      return;
    }

    if (job.tool === 'httpx') {
      logJobResult(db, job.id, 'run_tool', 'running', 'Running httpx in batches');
      const result = await executeHttpxJob(db, job);
      logJobResult(db, job.id, 'parse_store', 'completed', `HTTPX enrichment completed (${result.enriched}/${result.scanned})`, result.rawOutput || '');

      const output = [
        'tool=httpx',
        `target=${target.value}`,
        `scanned=${result.scanned}`,
        `enriched=${result.enriched}`,
        '',
        result.rawOutput || '',
      ].join('\n').trim();

      db.prepare("UPDATE jobs SET status='completed', output=?, finished_at=datetime('now') WHERE id=?").run(output, job.id);
      logJobResult(db, job.id, 'pipeline', 'completed', 'Job completed', output);
      return;
    }

    const runner = getRunner(job.tool);
    if (!runner) throw new Error(`unsupported tool: ${job.tool}`);

    logJobResult(db, job.id, 'run_tool', 'running', `Running ${job.tool}`);
    const rawOutput = await runner(target.value);
    logJobResult(db, job.id, 'run_tool', 'completed', `${job.tool} execution finished`, rawOutput || '');

    const parsedSubdomains = parseSubdomainOutput(rawOutput);
    const inserted = saveSubdomains(db, job, parsedSubdomains);
    logJobResult(db, job.id, 'parse_store', 'completed', `Parsed ${parsedSubdomains.length}, inserted ${inserted}`);

    const output = [
      `tool=${job.tool}`,
      `target=${target.value}`,
      `results=${parsedSubdomains.length}`,
      `inserted=${inserted}`,
      '',
      parsedSubdomains.join('\n'),
    ].join('\n').trim();

    db.prepare("UPDATE jobs SET status='completed', output=?, finished_at=datetime('now') WHERE id=?").run(output, job.id);
    logJobResult(db, job.id, 'pipeline', 'completed', 'Job completed', output);
  } finally {
    db.close();
  }
}

function processNextJob() {
  const db = getDb();

  try {
    const running = db.prepare("SELECT id FROM jobs WHERE status='running' LIMIT 1").get();
    if (running) return;

    const pending = db.prepare("SELECT id, workspace_id, target_id, subdomain_id, tool FROM jobs WHERE status='pending' ORDER BY id ASC LIMIT 1").get();
    if (!pending) return;

    const claimed = db.prepare("UPDATE jobs SET status='running', started_at=COALESCE(started_at, datetime('now')) WHERE id=? AND status='pending'").run(pending.id);
    if (!claimed.changes) return;

    executeJob(pending).catch((err) => {
      const message = err?.message || 'job execution failed';
      markJobFailed(pending.id, message);
    });
  } finally {
    db.close();
  }
}

function startJobWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(processNextJob, POLL_INTERVAL_MS);
  processNextJob();
  console.log('[JOBS] Worker started (sequential mode)');
}

module.exports = { startJobWorker };
