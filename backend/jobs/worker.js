const { getDb } = require('../db/init');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const POLL_INTERVAL_MS = 3000;
const TOOL_TIMEOUT_MS = 60 * 1000;
const HTTPX_BATCH_SIZE = 75;

let workerTimer = null;

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

    const pending = db.prepare("SELECT id, workspace_id, target_id, tool FROM jobs WHERE status='pending' ORDER BY id ASC LIMIT 1").get();
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
