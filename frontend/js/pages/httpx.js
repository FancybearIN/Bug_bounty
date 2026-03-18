// HTTPX Intelligence Page
// Displays filtered HTTPX results for a selected target

function getHttpxFiltersFromUI() {
  return {
    targetId: document.getElementById('hx-target-id')?.value || '',
    status: document.getElementById('hx-status')?.value || '',
    tech: document.getElementById('hx-tech')?.value.trim() || '',
    cdn: document.getElementById('hx-cdn')?.value || '',
    keyword: document.getElementById('hx-keyword')?.value.trim() || '',
    hasParams: document.getElementById('hx-has-params')?.value || '',
    tag: document.getElementById('hx-tag')?.value.trim() || '',
    sort: document.getElementById('hx-sort')?.value || '',
  };
}

function renderHttpxTableRows(items) {
  if (!items.length) {
    return `<tr><td colspan="6" style="color:var(--text3);">No matching results</td></tr>`;
  }

  return items.map((row) => {
    const tech = Array.isArray(row.tech) ? row.tech.join(', ') : '';
    const status = row.status || '—';
    let statusColor = 'var(--critical)';
    if (row.status < 400) statusColor = 'var(--success)';
    else if (row.status === 403) statusColor = 'var(--high)';
    const statusHtml = row.status
      ? `${statusDot(row.status)} <span style="font-family:var(--mono);color:${statusColor};">${status}</span>`
      : '<span style="color:var(--text3);">—</span>';
    return `
      <tr>
        <td class="text-mono">${escHtml(row.subdomain)}</td>
        <td>${statusHtml}</td>
        <td>${escHtml(row.title || '—')}</td>
        <td>${escHtml(tech || '—')}</td>
        <td>${escHtml(row.server || '—')}</td>
        <td>${row.cdn ? '<span class="tag">CDN</span>' : '<span style="color:var(--text3);">No</span>'}</td>
      </tr>`;
  }).join('');
}

async function applyHttpxFilters() {
  const filters = getHttpxFiltersFromUI();
  const tableBody = document.getElementById('httpx-table-body');
  if (!tableBody) return;

  if (!filters.targetId) {
    tableBody.innerHTML = '<tr><td colspan="6" style="color:var(--text3);">Select a target to load HTTPX intelligence</td></tr>';
    return;
  }

  tableBody.innerHTML = '<tr><td colspan="6" style="color:var(--text3);">Loading...</td></tr>';

  try {
    const data = await API.getFilteredSubdomains(filters.targetId, {
      status: filters.status,
      tech: filters.tech,
      cdn: filters.cdn,
      keyword: filters.keyword,
      has_params: filters.hasParams,
      tag: filters.tag,
      sort: filters.sort,
    });

    const items = Array.isArray(data.results) ? data.results : [];
    tableBody.innerHTML = renderHttpxTableRows(items);
    const countEl = document.getElementById('httpx-total-count');
    if (countEl) countEl.textContent = String(items.length);
  } catch (e) {
    tableBody.innerHTML = `<tr><td colspan="6" style="color:var(--critical);">${escHtml(e.message)}</td></tr>`;
  }
}

async function runDiscoveryFromHttpx() {
  const targetId = document.getElementById('hx-target-id')?.value;
  if (!targetId) {
    toast('Select a target first', 'error');
    return;
  }
  try {
    const result = await API.runSubdomainDiscovery(targetId, ['subfinder', 'assetfinder', 'chaos', 'amass']);
    toast(`Discovery completed: ${result.inserted} inserted`, 'success');
    await refreshReconFlowCard();
    await applyHttpxFilters();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function runHttpxFromPage() {
  const targetId = document.getElementById('hx-target-id')?.value;
  if (!targetId) {
    toast('Select a target first', 'error');
    return;
  }
  try {
    const result = await API.runHttpxPipeline(targetId);
    toast(`HTTPX completed: ${result.updated} updated, ${result.alive} alive`, 'success');
    await refreshReconFlowCard();
    await applyHttpxFilters();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function promoteAliveFromPage() {
  const targetId = document.getElementById('hx-target-id')?.value;
  if (!targetId) {
    toast('Select a target first', 'error');
    return;
  }
  try {
    const result = await API.promoteAliveDomains(targetId);
    toast(`Promoted ${result.promoted} alive domains`, 'success');
    await refreshReconFlowCard();
    await applyHttpxFilters();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function refreshReconFlowCard() {
  const wsId = getActiveWorkspace();
  const el = document.getElementById('httpx-flow-card');
  if (!el) return;

  try {
    const flow = await API.getReconFlow(wsId);
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-family:var(--mono);font-size:12px;">
        <span>[ Scope ] ${flow.scope}</span>
        <span>→</span>
        <span>[ Subdomains ] ${flow.subdomains}</span>
        <span>→</span>
        <span>[ Alive ] ${flow.alive}</span>
        <span>→</span>
        <span>[ Tested ] ${flow.tested}</span>
      </div>`;
  } catch {
    el.innerHTML = '<span style="color:var(--text3);font-size:12px;">Recon flow unavailable</span>';
  }
}

async function renderHttpx() {
  const wsId = requireWorkspace();
  if (!wsId) return;

  try {
    setTopbar('HTTPX', `${getActiveWorkspaceName()} — HTTP response intelligence`);
    setTopbarActions('');

    document.getElementById('content').innerHTML = `<div style="color:var(--text3);font-size:13px;">Loading HTTPX data...</div>`;

    const [subdomains, targets] = await Promise.all([
      API.getSubdomains(wsId).catch(() => []),
      API.getTargets(wsId, 'domain').catch(() => []),
    ]);

    const targetOptions = targets.length
      ? targets.map((t) => `<option value="${t.id}">${escHtml(t.value)}</option>`).join('')
      : '';

    const targetControl = targets.length
      ? `<select class="form-control" id="hx-target-id">${targetOptions}</select>`
      : `<p style="color:var(--text3);font-size:12px;">No targets available. Upload scope to create targets.</p>`;

    const statsTargetCount = targets.length || 0;
    const statsSubdomainCount = subdomains.length || 0;

    document.getElementById('content').innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-title">Recon Flow</div>
        <div id="httpx-flow-card" style="color:var(--text3);font-size:12px;">Loading flow...</div>
      </div>

      <div class="stats-row">
        <div class="stat-card"><div class="stat-value">${statsTargetCount}</div><div class="stat-label">Targets</div></div>
        <div class="stat-card"><div class="stat-value">${statsSubdomainCount}</div><div class="stat-label">Subdomains</div></div>
        <div class="stat-card"><div class="stat-value" id="httpx-total-count">0</div><div class="stat-label">Filtered Results</div></div>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div class="card-title">Target & Filters</div>
        <div class="form-row" style="margin-bottom:10px;">
          <div class="form-group">
            <label>Select Target Domain</label>
            ${targetControl}
          </div>
          <div class="form-group">
            <label>HTTP Status</label>
            <select class="form-control" id="hx-status">
              <option value="">All</option>
              <option value="200">200</option>
              <option value="301">301</option>
              <option value="302">302</option>
              <option value="403">403</option>
              <option value="404">404</option>
              <option value="500">500</option>
            </select>
          </div>
          <div class="form-group">
            <label>Sort By</label>
            <select class="form-control" id="hx-sort">
              <option value="">Default</option>
              <option value="status">Status Code</option>
              <option value="created_at">Created At</option>
            </select>
          </div>
        </div>
        <div class="form-row" style="margin-bottom:10px;">
          <div class="form-group">
            <label>Technology</label>
            <input class="form-control" id="hx-tech" placeholder="nginx" />
          </div>
          <div class="form-group">
            <label>CDN</label>
            <select class="form-control" id="hx-cdn">
              <option value="">Include / Exclude CDN</option>
              <option value="false">Exclude CDN</option>
              <option value="true">Only CDN</option>
            </select>
          </div>
          <div class="form-group">
            <label>Param Presence</label>
            <select class="form-control" id="hx-has-params">
              <option value="">Any</option>
              <option value="true">Has parameters</option>
              <option value="false">No parameters</option>
            </select>
          </div>
        </div>
        <div class="form-row" style="margin-bottom:10px;">
          <div class="form-group">
            <label>Keyword</label>
            <input class="form-control" id="hx-keyword" placeholder="admin, login" />
          </div>
          <div class="form-group">
            <label>Tag</label>
            <input class="form-control" id="hx-tag" placeholder="prod, staging" />
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="btn btn-ghost btn-sm" onclick="runDiscoveryFromHttpx()">Start Discovery</button>
          <button class="btn btn-ghost btn-sm" onclick="runHttpxFromPage()">Run HTTPX</button>
          <button class="btn btn-primary btn-sm" onclick="promoteAliveFromPage()">Promote Alive Domains</button>
        </div>
        <button class="btn btn-primary btn-sm" onclick="applyHttpxFilters()">Apply Filters</button>
      </div>

      <div class="card">
        <div class="card-title">HTTPX Intelligence Results</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subdomain</th>
                <th>Status</th>
                <th>Title</th>
                <th>Tech</th>
                <th>Server</th>
                <th>CDN</th>
              </tr>
            </thead>
            <tbody id="httpx-table-body">
              <tr><td colspan="6" style="color:var(--text3);">Select target and apply filters</td></tr>
            </tbody>
          </table>
        </div>
      </div>`;

    if (targets.length) {
      const targetEl = document.getElementById('hx-target-id');
      if (targetEl) targetEl.value = String(targets[0].id);
      refreshReconFlowCard();
      applyHttpxFilters();
    } else {
      refreshReconFlowCard();
    }
  } catch (e) {
    console.error('renderHttpx error:', e);
    document.getElementById('content').innerHTML = `<div class="card"><div class="card-title">HTTPX</div><p style="color:var(--critical);font-size:12px;">Failed to render: ${escHtml(e.message || 'unknown error')}</p></div>`;
  }
}
