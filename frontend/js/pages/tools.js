async function renderTools() {
  const wsId = requireWorkspace();
  if (!wsId) return;

  setTopbar('Tools', `${getActiveWorkspaceName()} — installed tools and execution settings`);
  setTopbarActions('');
  document.getElementById('content').innerHTML = `<div style="color:var(--text3);font-size:13px;">Loading tools...</div>`;

  try {
    const [statusResp, settingsResp] = await Promise.all([
      API.getToolsStatus(wsId),
      API.getToolSettings(wsId).catch(() => []),
    ]);

    const installed = statusResp?.installed || {};
    const rowSettings = Array.isArray(settingsResp) ? settingsResp : [];
    const byTool = new Map(rowSettings.map((s) => [s.tool, s]));

    const tools = Object.keys(installed).sort((a, b) => a.localeCompare(b));
    const installedCount = tools.filter((t) => installed[t]).length;
    const enabledCount = tools.filter((t) => (byTool.get(t)?.enabled ?? true)).length;

    const EXTENSIONS_TOOLS = new Set(['ffuf', 'dirsearch']);

    const rows = tools.map((tool) => {
      const row = byTool.get(tool);
      const enabled = row ? !!row.enabled : true;
      const cfg = row?.config || {};
      const extField = EXTENSIONS_TOOLS.has(tool)
        ? `<input class="form-control" id="tool-ext-${escHtml(tool)}" placeholder="php,html,js" value="${escHtml(String(cfg.extensions || ''))}" />`
        : '<span style="color:var(--text3);">—</span>';

      return `
      <tr>
        <td class="text-mono">${escHtml(tool)}</td>
        <td>${installed[tool] ? '<span class="badge badge-info">installed</span>' : '<span class="badge badge-critical">missing</span>'}</td>
        <td>
          <label style="display:inline-flex;align-items:center;gap:6px;">
            <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleToolEnabled('${escHtml(tool)}', this.checked)" />
            <span>${enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </td>
        <td>
          <input class="form-control" id="tool-wordlist-${escHtml(tool)}" placeholder="wordlist path" value="${escHtml(cfg.wordlist || '')}" />
        </td>
        <td>
          <input class="form-control" id="tool-threads-${escHtml(tool)}" type="number" min="1" value="${escHtml(String(cfg.threads || ''))}" />
        </td>
        <td>
          <input class="form-control" id="tool-rate-${escHtml(tool)}" type="number" min="1" value="${escHtml(String(cfg.rate_limit || ''))}" />
        </td>
        <td>${extField}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-primary btn-sm" onclick="saveToolConfig('${escHtml(tool)}')">Save</button>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('content').innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-value">${tools.length}</div><div class="stat-label">Known Tools</div></div>
        <div class="stat-card"><div class="stat-value">${installedCount}</div><div class="stat-label">Installed</div></div>
        <div class="stat-card"><div class="stat-value">${enabledCount}</div><div class="stat-label">Enabled</div></div>
      </div>

      <div class="card">
        <div class="card-title">Tool Settings</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Status</th>
                <th>Enable</th>
                <th>Wordlist</th>
                <th>Threads</th>
                <th>Rate Limit</th>
                <th>Extensions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  } catch (e) {
    document.getElementById('content').innerHTML = `<div class="card"><div class="card-title">Tools</div><p style="color:var(--critical);font-size:12px;">${escHtml(e.message)}</p></div>`;
  }
}

async function toggleToolEnabled(tool, enabled) {
  const wsId = getActiveWorkspace();
  try {
    await API.setToolSettings(wsId, tool, enabled, readToolConfigFromUI(tool));
    toast(`${tool} ${enabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
    renderTools();
  }
}

function readToolConfigFromUI(tool) {
  const wordlist = document.getElementById(`tool-wordlist-${tool}`)?.value.trim() || '';
  const threads = Number(document.getElementById(`tool-threads-${tool}`)?.value || 0) || undefined;
  const rate_limit = Number(document.getElementById(`tool-rate-${tool}`)?.value || 0) || undefined;
  const extensionsRaw = document.getElementById(`tool-ext-${tool}`)?.value.trim() || '';
  const extensions = extensionsRaw || undefined;
  return {
    wordlist: wordlist || undefined,
    threads,
    rate_limit,
    extensions,
  };
}

async function saveToolConfig(tool) {
  const wsId = getActiveWorkspace();
  try {
    await API.setToolSettings(wsId, tool, true, readToolConfigFromUI(tool));
    toast(`${tool} settings saved`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}
