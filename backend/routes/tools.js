const express = require('express');
const { spawnSync } = require('node:child_process');
const { getDb } = require('../db/init');

const router = express.Router();

const TOOL_LIST = [
  'subfinder',
  'assetfinder',
  'chaos',
  'httpx',
  'dirsearch',
  'ffuf',
  'gobuster',
  'arjun',
  'paramspider',
  'waybackurls',
  'amass',
];

function isInstalled(tool) {
  const result = spawnSync(tool, ['-h'], { stdio: 'ignore', timeout: 2500 });
  return result.error?.code !== 'ENOENT';
}

function parseConfig(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

router.get('/status', (req, res) => {
  const { workspace_id } = req.query;

  const installed = {};
  for (const tool of TOOL_LIST) installed[tool] = isInstalled(tool);

  if (!workspace_id) return res.json({ installed });

  const db = getDb();
  try {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspace_id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const rows = db.prepare('SELECT tool, enabled, config FROM tool_settings WHERE workspace_id=?').all(workspace_id);
    const byTool = new Map(rows.map((r) => [String(r.tool), r]));

    const settings = {};
    for (const tool of TOOL_LIST) {
      const row = byTool.get(tool);
      settings[tool] = {
        enabled: row ? Number(row.enabled) === 1 : true,
        config: row ? parseConfig(row.config) : {},
      };
    }

    res.json({ installed, settings });
  } finally {
    db.close();
  }
});

router.get('/settings', (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  const db = getDb();
  try {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspace_id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const rows = db.prepare('SELECT tool, enabled, config FROM tool_settings WHERE workspace_id=? ORDER BY tool ASC').all(workspace_id);
    res.json(rows.map((r) => ({ tool: r.tool, enabled: Number(r.enabled) === 1, config: parseConfig(r.config) })));
  } finally {
    db.close();
  }
});

router.patch('/settings', (req, res) => {
  const { workspace_id, tool, enabled, config } = req.body;
  if (!workspace_id || !tool) return res.status(400).json({ error: 'workspace_id and tool required' });

  const cleanTool = String(tool).trim().toLowerCase();
  if (!TOOL_LIST.includes(cleanTool)) {
    return res.status(400).json({ error: 'Unsupported tool' });
  }

  const db = getDb();
  try {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspace_id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    db.prepare(`
      INSERT INTO tool_settings (workspace_id, tool, enabled, config)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, tool) DO UPDATE SET
        enabled = excluded.enabled,
        config = excluded.config
    `).run(workspace_id, cleanTool, enabled === false ? 0 : 1, JSON.stringify(config || {}));

    const row = db.prepare('SELECT tool, enabled, config FROM tool_settings WHERE workspace_id=? AND tool=?').get(workspace_id, cleanTool);
    res.json({ tool: row.tool, enabled: Number(row.enabled) === 1, config: parseConfig(row.config) });
  } finally {
    db.close();
  }
});

module.exports = router;
