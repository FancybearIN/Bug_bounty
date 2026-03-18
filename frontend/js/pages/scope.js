const scopeState = {
  activeWorkspace: null,
  activeDomain: null,
  activeTargetId: null,
  activeSubdomain: null,
  onlyActive: false,
  autoReconMode: false,
};

function normalizeScopeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

function isDomainScopeEntry(entry) {
  return entry?.type === 'domain' || entry?.type === 'wildcard';
}

function collectParamNames(entry) {
  if (typeof entry === 'string') return [entry];
  if (!entry || typeof entry !== 'object') return [];

  const names = [];
  if (entry.key) names.push(String(entry.key));
  if (entry.name) names.push(String(entry.name));
  return names;
}

async function loadTarget(domain) {
  const wsId = scopeState.activeWorkspace;
  if (!wsId || !domain) {
    scopeState.activeTargetId = null;
    setActiveTargetId('');
    return null;
  }

  const targets = await API.getTargets(wsId, 'domain').catch(() => []);
  const match = targets.find((t) => normalizeScopeDomain(t.value) === normalizeScopeDomain(domain));

  if (!match) {
    scopeState.activeTargetId = null;
    setActiveTargetId('');
    return null;
  }

  scopeState.activeTargetId = Number(match.id);
  setActiveTargetId(String(match.id));
  return match;
}

function highlightActiveScopeRow() {
  const active = normalizeScopeDomain(scopeState.activeDomain || '');
  document.querySelectorAll('tr[data-scope-domain]').forEach((tr) => {
    const rowDomain = normalizeScopeDomain(tr.dataset.scopeDomain || '');
    tr.classList.toggle('scope-row-active', Boolean(active && rowDomain === active));
  });
}

function aggregateParams(subdomains) {
  const found = new Set();
  for (const sd of subdomains) {
    const params = Array.isArray(sd?.params_data) ? sd.params_data : [];
    for (const p of params) {
      const names = collectParamNames(p);
      for (const name of names) {
        found.add(name);
      }
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function summarizeHttpx(subdomains) {
  const rows = [];
  for (const sd of subdomains) {
    const h = sd?.httpx_data;
    if (!h || typeof h !== 'object') continue;
    const status = Number(h.status);
    if (Number.isNaN(status)) continue;

    rows.push({
      value: sd.value,
      status,
      title: h.title || '',
      tech: Array.isArray(h.tech) ? h.tech : [],
    });
  }
  rows.sort((a, b) => a.value.localeCompare(b.value));
  return rows;
}

function buildCurrentTargetCard(data) {
  const activeDomain = scopeState.activeDomain || '—';
  const parentDomain = activeDomain.startsWith('*.') ? activeDomain.slice(2) : activeDomain;
  const activeSubdomain = scopeState.activeSubdomain || '—';
  const targetIdText = scopeState.activeTargetId ? `#${scopeState.activeTargetId}` : 'not resolved';

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Current Target</div>
      <div class="target-context-grid">
        <div><div class="target-context-label">Selected Domain</div><div class="target-context-value text-mono">${escHtml(activeDomain)}</div></div>
        <div><div class="target-context-label">Parent Domain</div><div class="target-context-value text-mono">${escHtml(parentDomain || '—')}</div></div>
        <div><div class="target-context-label">Active Subdomain</div><div class="target-context-value text-mono">${escHtml(activeSubdomain)}</div></div>
        <div><div class="target-context-label">Target ID</div><div class="target-context-value text-mono">${escHtml(targetIdText)}</div></div>
      </div>
      <div style="margin-top:10px;color:var(--text3);font-size:12px;">
        Subdomains: ${data.subdomains.length} · HTTPX: ${data.httpxRows.length} · Params: ${data.params.length} · Findings: ${data.findings.length}
      </div>
    </div>`;
}

function renderSubdomainsPanel(subdomains) {
  if (subdomains.length === 0) {
    return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Subdomains</div>
      <p style="color:var(--text3);font-size:12px;">No subdomains matched this target.</p>
    </div>`;
  }

  const rows = subdomains.slice(0, 20).map((sd) => {
    const status = sd.httpx_data?.status;
    let statusHtml = '<span style="color:var(--text3);">—</span>';
    if (status) {
      statusHtml = `${statusDot(status)} <span class="text-mono">${escHtml(String(status))}</span>`;
    }

    return `
      <tr>
        <td class="text-mono">${escHtml(sd.value)}</td>
        <td>${statusHtml}</td>
        <td>${escHtml(sd.httpx_data?.title || '—')}</td>
      </tr>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Subdomains</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Subdomain</th><th>Status</th><th>Title</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderHttpxPanel(httpxRows) {
  if (httpxRows.length === 0) {
    return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">HTTPX Intelligence</div>
      <p style="color:var(--text3);font-size:12px;">No HTTPX rows available.</p>
    </div>`;
  }

  const rows = httpxRows.slice(0, 20).map((row) => `
    <tr>
      <td class="text-mono">${escHtml(row.value)}</td>
      <td>${statusDot(row.status)} <span class="text-mono">${escHtml(String(row.status))}</span></td>
      <td>${escHtml(row.title || '—')}</td>
      <td>${escHtml(row.tech.join(', ') || '—')}</td>
    </tr>`).join('');

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">HTTPX Intelligence</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Subdomain</th><th>Status</th><th>Title</th><th>Tech</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderParamsPanel(params) {
  if (params.length === 0) {
    return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Parameters</div>
      <p style="color:var(--text3);font-size:12px;">No parameter intelligence found yet.</p>
    </div>`;
  }

  const tags = params.slice(0, 80).map((p) => `<span class="tag">${escHtml(p)}</span>`).join('');
  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Parameters</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${tags}</div>
    </div>`;
}

function renderFindingsPanel(findings) {
  if (findings.length === 0) {
    return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Notes / Findings</div>
      <p style="color:var(--text3);font-size:12px;">No findings linked to this target.</p>
    </div>`;
  }

  const rows = findings.slice(0, 20).map((f) => {
    const reportedHtml = f.reported ? '<span class="badge badge-info">Yes</span>' : '<span style="color:var(--text3);">No</span>';
    return `
      <tr>
        <td>${badgeSeverity((f.severity || '').toUpperCase())}</td>
        <td>${escHtml(f.title || '')}</td>
        <td>${reportedHtml}</td>
      </tr>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Notes / Findings</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Severity</th><th>Title</th><th>Reported</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderChecklistPanel(checklist) {
  if (!checklist) {
    return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Checklist (Target Scoped)</div>
      <p style="color:var(--text3);font-size:12px;">Target checklist unavailable for this selection.</p>
    </div>`;
  }

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Checklist (Target Scoped)</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <span class="badge badge-info">Not Tested: ${checklist.statuses?.not_tested || 0}</span>
        <span class="badge badge-info">Testing: ${checklist.statuses?.testing || 0}</span>
        <span class="badge badge-info">Done: ${checklist.statuses?.done || 0}</span>
        <span class="badge badge-info">Vulnerable: ${checklist.statuses?.vulnerable || 0}</span>
      </div>
    </div>`;
}

function renderJobsPanel(jobs) {
  if (jobs.length === 0) {
    return `
    <div class="card">
      <div class="card-title">Recon Tracking</div>
      <p style="color:var(--text3);font-size:12px;">No recon jobs recorded for this target yet.</p>
    </div>`;
  }

  const rows = jobs.slice(0, 20).map((j) => `
    <tr>
      <td class="text-mono">${escHtml(j.tool)}</td>
      <td>${badgeStatus(j.status)}</td>
      <td class="text-mono">${escHtml(j.created_at || '—')}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <div class="card-title">Recon Tracking</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tool</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderCoveragePanel(coverage) {
  if (!coverage) {
    return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Testing Coverage</div>
      <p style="color:var(--text3);font-size:12px;">Coverage data unavailable for this target.</p>
    </div>`;
  }

  const moduleRows = (coverage.modules || []).slice(0, 20).map((m) => `
    <tr>
      <td>${escHtml(m.module_name || '—')}</td>
      <td>${m.tested}/${m.total}</td>
      <td>${m.vulnerable}</td>
      <td>${m.percentage}%</td>
    </tr>`).join('');

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Testing Coverage</div>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
        <span class="badge badge-info">Tested: ${coverage.tested}/${coverage.total}</span>
        <span class="badge badge-info">Vulnerable: ${coverage.vulnerable}</span>
        <span class="badge badge-info">Coverage: ${coverage.percentage}%</span>
      </div>
      <div class="progress-bar" style="margin-bottom:12px;"><div class="progress-fill" style="width:${coverage.percentage}%;"></div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Module</th><th>Tested</th><th>Vulnerable</th><th>Coverage</th></tr></thead>
          <tbody>${moduleRows || '<tr><td colspan="4" style="color:var(--text3);">No linked modules</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function renderDomainDashboard(data) {
  const root = document.getElementById('scope-domain-dashboard');
  if (!root) return;

  if (!scopeState.activeDomain) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>No Domain Selected</h3>
        <p>Click a domain or wildcard scope entry to load target-specific recon and tracking context.</p>
      </div>`;
    return;
  }

  root.innerHTML = [
    buildCurrentTargetCard(data),
    renderCoveragePanel(data.coverage),
    renderSubdomainsPanel(data.subdomains),
    renderHttpxPanel(data.httpxRows),
    renderParamsPanel(data.params),
    renderFindingsPanel(data.findings),
    renderChecklistPanel(data.checklist),
    renderJobsPanel(data.jobs),
  ].join('');
}

async function selectDomain(domainValue) {
  scopeState.activeDomain = normalizeScopeDomain(domainValue);
  scopeState.activeSubdomain = null;
  setActiveDomain(scopeState.activeDomain);
  await loadTarget(scopeState.activeDomain);
  highlightActiveScopeRow();

  const wsId = scopeState.activeWorkspace;
  const subdomains = await API.getSubdomains(wsId).catch(() => []);
  const scopedSubdomains = subdomains.filter((sd) => {
    const v = normalizeScopeDomain(sd.value);
    return v === scopeState.activeDomain || v.endsWith(`.${scopeState.activeDomain}`);
  });

  if (scopedSubdomains.length) {
    scopeState.activeSubdomain = scopedSubdomains[0].value;
  }

  let findings = [];
  let checklist = null;
  let jobs = [];
  let coverage = null;
  let filteredHttpx = [];

  if (scopeState.activeTargetId) {
    [findings, checklist, jobs] = await Promise.all([
      API.getFindings(scopeState.activeTargetId).catch(() => []),
      API.getTargetChecklist(scopeState.activeTargetId).catch(() => null),
      API.getJobs(scopeState.activeTargetId).catch(() => []),
    ]);

    coverage = await API.getCoverage(scopeState.activeTargetId).catch(() => null);

    const intel = await API.getFilteredSubdomains(scopeState.activeTargetId, {}).catch(() => ({ results: [] }));
    filteredHttpx = Array.isArray(intel.results) ? intel.results : [];
  }

  const httpxRows = filteredHttpx.length
    ? filteredHttpx.map((row) => ({
      value: row.subdomain,
      status: row.status,
      title: row.title,
      tech: Array.isArray(row.tech) ? row.tech : [],
    }))
    : summarizeHttpx(scopedSubdomains);

  const params = aggregateParams(scopedSubdomains);
  renderDomainDashboard({
    subdomains: scopedSubdomains,
    httpxRows,
    params,
    findings,
    checklist,
    jobs,
    coverage,
  });
}

// Scope Page
async function renderScope() {
  const wsId = requireWorkspace();
  if (!wsId) return;

  scopeState.activeWorkspace = wsId;

  setTopbar('Scope', `${getActiveWorkspaceName()} — in-scope targets`);
  let autoModeEnabled = false;
  try {
    const autoMode = await API.getAutoReconMode(wsId);
    autoModeEnabled = !!autoMode.enabled;
  } catch {
    autoModeEnabled = false;
  }
  scopeState.autoReconMode = autoModeEnabled;

  setTopbarActions(`
    <label style="display:inline-flex;align-items:center;gap:6px;color:var(--text2);font-size:12px;">
      <input type="checkbox" id="scope-auto-recon" ${scopeState.autoReconMode ? 'checked' : ''} onchange="toggleAutoReconMode(this.checked)" />
      Auto Recon Mode
    </label>
    <button class="btn btn-ghost btn-sm" onclick="showAddScopeEntry()">+ Add Entry</button>
    <button class="btn btn-primary btn-sm" onclick="showUploadScope()">Upload File</button>
  `);

  document.getElementById('content').innerHTML = `<div style="color:var(--text3);font-size:13px;">Loading scope...</div>`;

  const entries = await API.getScope(wsId, scopeState.onlyActive).catch(() => []);

  const types = ['wildcard','domain','api','mobile','other'];
  const grouped = {};
  for (const t of types) grouped[t] = entries.filter(e => e.type === t);

  const total = entries.length;

  let contentHtml = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Entries</div></div>
      <div class="stat-card"><div class="stat-value stat-critical">${grouped.wildcard.length}</div><div class="stat-label">Wildcards</div></div>
      <div class="stat-card"><div class="stat-value">${grouped.domain.length}</div><div class="stat-label">Domains</div></div>
      <div class="stat-card"><div class="stat-value">${grouped.api.length}</div><div class="stat-label">API</div></div>
      <div class="stat-card"><div class="stat-value">${grouped.mobile.length}</div><div class="stat-label">Mobile</div></div>
    </div>`;

  if (total === 0) {
    contentHtml += `
      <div class="empty-state">
        <h3>No Scope Entries</h3>
        <p>Upload a HackerOne/Bugcrowd JSON or a plain TXT scope file.</p>
        <br><button class="btn btn-primary" onclick="showUploadScope()">Upload Scope File</button>
      </div>`;
  } else {
    contentHtml += `
    <div class="card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
      <div class="card-title" style="margin:0;">Scope Controls</div>
      <label style="display:inline-flex;align-items:center;gap:6px;color:var(--text2);font-size:12px;">
        <input type="checkbox" id="scope-only-active" ${scopeState.onlyActive ? 'checked' : ''} onchange="toggleOnlyActiveScope(this.checked)" />
        Show only ACTIVE scope
      </label>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Scope Entries (click domain rows to set context)</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Value</th><th>Notes</th><th>State</th><th></th></tr></thead>
          <tbody id="scope-table-body"></tbody>
        </table>
      </div>
    </div>
    <div id="scope-domain-dashboard"></div>`;
  }

  document.getElementById('content').innerHTML = contentHtml;

  if (total) {
    const tbody = document.getElementById('scope-table-body');
    for (const e of entries) {
      const clickable = isDomainScopeEntry(e);
      const tr = document.createElement('tr');
      if (clickable) {
        tr.classList.add('scope-row-clickable');
        tr.dataset.scopeDomain = e.value;
        tr.addEventListener('click', () => selectDomain(e.value));
      }

      tr.innerHTML = `
        <td>${badgeType(e.type)}</td>
        <td class="text-mono">${escHtml(e.value)}</td>
        <td style="color:var(--text3);font-size:12px;">${escHtml(e.notes || '')}</td>
        <td>${e.is_active ? '<span class="badge badge-info">ACTIVE</span>' : '<span style="color:var(--text3);">inactive</span>'}</td>
        <td style="white-space:nowrap;text-align:right;">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();toggleScopeEntryActive(${e.id}, ${e.is_active ? 'false' : 'true'})">${e.is_active ? 'Mark Inactive' : 'Mark Active'}</button>
          ${isDomainScopeEntry(e) ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();addScopeEntryToRecon(${e.id})">Add to Recon</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();deleteScopeEntry(${e.id})">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    }

    const persistedDomain = getActiveDomain();
    const domainEntries = entries.filter(isDomainScopeEntry);
    const chosen = domainEntries.find((e) => normalizeScopeDomain(e.value) === normalizeScopeDomain(persistedDomain)) || domainEntries[0];
    if (chosen) {
      await selectDomain(chosen.value);
    } else {
      renderDomainDashboard({
        subdomains: [],
        httpxRows: [],
        params: [],
        findings: [],
        checklist: null,
        jobs: [],
        coverage: null,
      });
    }
  }
}

function toggleOnlyActiveScope(enabled) {
  scopeState.onlyActive = !!enabled;
  renderScope();
}

async function toggleScopeEntryActive(id, nextValue) {
  try {
    await API.updateScopeActive(id, nextValue);
    toast('Scope state updated', 'success');
    renderScope();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function addScopeEntryToRecon(id) {
  try {
    const result = await API.addScopeToRecon(id);
    const jobsCreated = Number(result.jobs_created || 0);
    toast(jobsCreated > 0 ? `Added to recon. Auto jobs queued: ${jobsCreated}` : 'Added to recon', 'success');
    renderScope();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function toggleAutoReconMode(enabled) {
  const wsId = getActiveWorkspace();
  try {
    await API.setAutoReconMode(wsId, !!enabled);
    scopeState.autoReconMode = !!enabled;
    toast(`Auto Recon Mode ${enabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
    renderScope();
  }
}

function showUploadScope() {
  Modal.open({
    title: 'Upload Scope File',
    body: `
      <p style="color:var(--text3);font-size:12px;margin-bottom:16px;">
        Supports HackerOne JSON, Bugcrowd JSON, or plain TXT (one entry per line).<br>
        Duplicate entries are ignored automatically.
      </p>
      <div class="upload-zone" id="scope-upload-zone">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p>Click or drag & drop scope file here</p>
        <small>scope.json · scope.txt · hackerone.json</small>
      </div>
      <div id="scope-upload-result" style="margin-top:12px;font-size:12px;color:var(--text3);"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Close</button>`,
  });

  const zone = document.getElementById('scope-upload-zone');
  setupDropZone(zone, async (file) => {
    const workspaceName = getActiveWorkspaceName();
    zone.style.opacity = '0.5';
    zone.style.pointerEvents = 'none';
    try {
      const result = await API.uploadScope(file, workspaceName);
      document.getElementById('scope-upload-result').innerHTML =
        `<span style="color:var(--success);">✓ ${result.inserted} new entries added (${result.total} total)</span>`;
      toast(`${result.inserted} scope entries imported`, 'success');
      setTimeout(() => { Modal.close(); renderScope(); }, 1000);
    } catch (e) {
      document.getElementById('scope-upload-result').innerHTML = `<span style="color:var(--critical);">Error: ${escHtml(e.message)}</span>`;
      zone.style.opacity = '';
      zone.style.pointerEvents = '';
    }
  });
}

function showAddScopeEntry() {
  Modal.open({
    title: 'Add Scope Entry',
    body: `
      <div class="form-row">
        <div class="form-group">
          <label>Type</label>
          <select class="form-control" id="scope-type">
            <option value="domain">Domain</option>
            <option value="wildcard">Wildcard</option>
            <option value="api">API</option>
            <option value="mobile">Mobile</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group" style="flex:2;">
          <label>Value</label>
          <input class="form-control" id="scope-value" placeholder="*.example.com" />
        </div>
      </div>
      <div class="form-group">
        <label>Notes</label>
        <input class="form-control" id="scope-notes" placeholder="Optional notes" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="addScopeEntry()">Add</button>`,
  });
}

async function addScopeEntry() {
  const wsId = getActiveWorkspace();
  const type = document.getElementById('scope-type').value;
  const value = document.getElementById('scope-value').value.trim();
  const notes = document.getElementById('scope-notes').value.trim();
  if (!value) { toast('Value is required', 'error'); return; }
  try {
    await API.addScope({ workspace_id: wsId, type, value, notes });
    Modal.close();
    toast('Scope entry added', 'success');
    renderScope();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteScopeEntry(id) {
  await API.deleteScope(id);
  toast('Deleted');
  renderScope();
}
