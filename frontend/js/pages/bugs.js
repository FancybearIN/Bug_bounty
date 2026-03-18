// Bugs Page
let _currentBugId = null;

async function renderBugs() {
  const wsId = requireWorkspace();
  if (!wsId) return;

  setTopbar('Bugs', `${getActiveWorkspaceName()} — vulnerability tracking`);
  setTopbarActions(`<button class="btn btn-primary btn-sm" onclick="showBugModal()">+ Report Bug</button>`);

  document.getElementById('content').innerHTML = `<div style="color:var(--text3);font-size:13px;">Loading bugs...</div>`;

  const bugs = await API.getBugs(wsId).catch(() => []);
  const sevCount = (sev) => bugs.filter(b => b.severity === sev).length;

  const html = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-value" style="color:var(--critical);">${sevCount('Critical')}</div><div class="stat-label">Critical</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--high);">${sevCount('High')}</div><div class="stat-label">High</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--medium);">${sevCount('Medium')}</div><div class="stat-label">Medium</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--low);">${sevCount('Low')}</div><div class="stat-label">Low</div></div>
      <div class="stat-card"><div class="stat-value">${bugs.filter(b=>b.status==='Reported').length}</div><div class="stat-label">Reported</div></div>
      <div class="stat-card"><div class="stat-value">${bugs.length}</div><div class="stat-label">Total</div></div>
    </div>
    <div class="filter-bar">
      <input id="bug-search" placeholder="🔍  Search title, target, description..." oninput="filterBugs()" />
      <select id="bug-sev-filter" onchange="filterBugs()" style="min-width:100px;">
        <option value="">All Severities</option>
        <option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
      </select>
      <select id="bug-status-filter" onchange="filterBugs()" style="min-width:120px;">
        <option value="">All Statuses</option>
        <option>Not Tested</option><option>Testing</option><option>Found</option><option>Reported</option><option>Duplicate</option>
      </select>
    </div>
    ${!bugs.length ? `
      <div class="empty-state">
        <h3>No Bugs Tracked</h3>
        <p>Start tracking vulnerabilities you discover during reconnaissance.</p>
        <br><button class="btn btn-primary" onclick="showBugModal()">+ Report First Bug</button>
      </div>` : `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Title</th>
              <th>Target</th>
              <th>Module</th>
              <th>Status</th>
              <th>Reported</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="bug-table-body">
            ${bugs.map(b => bugRow(b)).join('')}
          </tbody>
        </table>
      </div>
    </div>`}`;

  document.getElementById('content').innerHTML = html;
}

function bugRow(b) {
  return `
    <tr data-bug-id="${b.id}" data-bug-sev="${b.severity}" data-bug-status="${b.status}"
        data-bug-search="${escHtml((b.title + b.target + (b.description||'')).toLowerCase())}">
      <td>${badgeSeverity(b.severity)}</td>
      <td style="max-width:280px;">
        <div style="font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(b.title)}">${escHtml(b.title)}</div>
        ${b.description ? `<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(b.description)}">${escHtml(b.description.slice(0,80))}${b.description.length>80?'…':''}</div>` : ''}
      </td>
      <td class="text-mono" style="font-size:11px;color:var(--text2);">${escHtml(b.target||'—')}</td>
      <td style="font-size:12px;color:var(--text3);">${escHtml(b.module_name||'—')}</td>
      <td>
        <select class="status-pill status-${(b.status||'not tested').toLowerCase().replace(/\s+/g,'-')}"
          style="background:transparent;border:none;color:inherit;cursor:pointer;font-size:10px;font-family:var(--mono);"
          onchange="updateBugStatus(${b.id}, this.value, this)">
          ${['Not Tested','Testing','Found','Reported','Duplicate'].map(s =>
            `<option value="${s}" ${s===b.status?'selected':''}>${s}</option>`
          ).join('')}
        </select>
      </td>
      <td>
        <label class="toggle" title="${b.reported ? 'Reported' : 'Not reported'}">
          <input type="checkbox" ${b.reported ? 'checked' : ''} onchange="updateBugReported(${b.id}, this.checked)" />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td style="white-space:nowrap;text-align:right;">
        <button class="btn btn-ghost btn-sm" onclick="showBugDetail(${b.id})">View</button>
        <button class="btn btn-ghost btn-sm" onclick="showBugModal(${b.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteBug(${b.id},'${escHtml(b.title)}')">✕</button>
      </td>
    </tr>`;
}

function filterBugs() {
  const q = (document.getElementById('bug-search')?.value || '').toLowerCase();
  const sev = document.getElementById('bug-sev-filter')?.value || '';
  const status = document.getElementById('bug-status-filter')?.value || '';

  document.querySelectorAll('#bug-table-body tr').forEach(row => {
    const matchQ = !q || row.dataset.bugSearch?.includes(q);
    const matchSev = !sev || row.dataset.bugSev === sev;
    const matchStatus = !status || row.dataset.bugStatus === status;
    row.style.display = (matchQ && matchSev && matchStatus) ? '' : 'none';
  });
}

async function updateBugStatus(id, status, selectEl) {
  const oldClass = selectEl.className;
  try {
    const updated = await API.updateBug(id, { status });
    toast('Status updated', 'success');
    const newClass = `status-pill status-${status.toLowerCase().replace(/\s+/g,'-')}`;
    selectEl.className = `${newClass} ` + 'style="background:transparent;border:none;color:inherit;cursor:pointer;font-size:10px;font-family:var(--mono);"';
    selectEl.style.cssText = 'background:transparent;border:none;color:inherit;cursor:pointer;font-size:10px;font-family:var(--mono);';
    const row = selectEl.closest('tr');
    if (row) {
      row.dataset.bugStatus = status;
      selectEl.className = `status-pill status-${status.toLowerCase().replace(/\s+/g,'-')}`;
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function updateBugReported(id, reported) {
  try {
    await API.updateBug(id, { reported });
    toast(reported ? 'Marked as reported' : 'Marked as not reported', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function showBugModal(bugId = null) {
  _currentBugId = bugId;
  const wsId = getActiveWorkspace();

  const modules = await API.getModules(wsId).catch(() => []);
  const allMods = [];
  for (const m of modules) {
    allMods.push({ id: m.id, name: m.name, indent: '' });
    for (const s of m.children || []) allMods.push({ id: s.id, name: s.name, indent: '  └ ' });
  }

  let bug = null;
  if (bugId) {
    bug = await API.getBugs(wsId).then(bs => bs.find(b => b.id == bugId)).catch(() => null);
  }

  Modal.open({
    title: bugId ? 'Edit Bug' : 'Report Bug',
    wide: true,
    body: `
      <div class="form-group">
        <label>Title *</label>
        <input class="form-control" id="bug-title" value="${escHtml(bug?.title||'')}" placeholder="SQL Injection in /api/login — username parameter" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Severity *</label>
          <select class="form-control" id="bug-severity">
            ${['Critical','High','Medium','Low'].map(s => `<option ${s===(bug?.severity||'High')?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-control" id="bug-status">
            ${['Not Tested','Testing','Found','Reported','Duplicate'].map(s => `<option ${s===(bug?.status||'Not Tested')?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Target (domain/subdomain/endpoint)</label>
          <input class="form-control" id="bug-target" value="${escHtml(bug?.target||'')}" placeholder="api.example.com" />
        </div>
        <div class="form-group">
          <label>Module</label>
          <select class="form-control" id="bug-module">
            <option value="">— None —</option>
            ${allMods.map(m => `<option value="${m.id}" ${m.id==bug?.module_id?'selected':''}>${m.indent}${escHtml(m.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="form-control" id="bug-description" rows="3" placeholder="Brief summary of the vulnerability...">${escHtml(bug?.description||'')}</textarea>
      </div>
      <div class="form-group">
        <label>Steps to Reproduce</label>
        <textarea class="form-control" id="bug-steps" rows="4" placeholder="1. Login as user A\n2. Send request...\n3. Observe...">${escHtml(bug?.steps||'')}</textarea>
      </div>
      <div class="form-group">
        <label>Impact</label>
        <textarea class="form-control" id="bug-impact" rows="2" placeholder="Unauthorized access to all user data...">${escHtml(bug?.impact||'')}</textarea>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:12px;">
        <label style="margin:0;">Reported to program</label>
        <label class="toggle">
          <input type="checkbox" id="bug-reported" ${bug?.reported ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="saveBug()">Save Bug</button>`,
  });
}

async function saveBug() {
  const wsId = getActiveWorkspace();
  const title = document.getElementById('bug-title').value.trim();
  const severity = document.getElementById('bug-severity').value;
  const status = document.getElementById('bug-status').value;
  const target = document.getElementById('bug-target').value.trim();
  const module_id = document.getElementById('bug-module').value || null;
  const description = document.getElementById('bug-description').value.trim();
  const steps = document.getElementById('bug-steps').value.trim();
  const impact = document.getElementById('bug-impact').value.trim();
  const reported = document.getElementById('bug-reported').checked;

  if (!title) { toast('Title is required', 'error'); return; }

  try {
    if (_currentBugId) {
      await API.updateBug(_currentBugId, { title, severity, status, target, module_id, description, steps, impact, reported });
      toast('Bug updated', 'success');
    } else {
      await API.createBug({ workspace_id: wsId, title, severity, status, target, module_id, description, steps, impact, reported });
      toast('Bug reported', 'success');
    }
    Modal.close();
    renderBugs();
  } catch (e) { toast(e.message, 'error'); }
}

function showBugDetail(bugId) {
  API.getBugs(getActiveWorkspace()).then(bugs => {
    const b = bugs.find(x => x.id == bugId);
    if (!b) return;
    Modal.open({
      title: 'Bug Detail',
      wide: true,
      body: `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          ${badgeSeverity(b.severity)} ${badgeStatus(b.status)}
          ${b.reported ? `<span class="badge badge-info" style="font-size:9px;">REPORTED</span>` : ''}
        </div>
        <h2 style="font-size:15px;font-weight:600;margin-bottom:8px;">${escHtml(b.title)}</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div><div class="text-xs text-dim" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Target</div><div class="text-mono">${escHtml(b.target||'—')}</div></div>
          <div><div class="text-xs text-dim" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Module</div><div class="text-sm">${escHtml(b.module_name||'—')}</div></div>
        </div>
        ${b.description ? `<div class="form-group"><div class="text-xs text-dim" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Description</div><div style="font-size:13px;white-space:pre-wrap;">${escHtml(b.description)}</div></div>` : ''}
        ${b.steps ? `<div class="form-group"><div class="text-xs text-dim" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Steps to Reproduce</div><div class="code-block">${escHtml(b.steps)}</div></div>` : ''}
        ${b.impact ? `<div class="form-group"><div class="text-xs text-dim" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Impact</div><div style="font-size:13px;">${escHtml(b.impact)}</div></div>` : ''}
        <div class="text-xs text-dim" style="margin-top:8px;">Tracked: ${fmtDate(b.created_at)}</div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Close</button>
        <button class="btn btn-primary" onclick="Modal.close();showBugModal(${b.id})">Edit</button>`,
    });
  });
}

function confirmDeleteBug(id, title) {
  Modal.open({
    title: 'Delete Bug',
    body: `<p style="color:var(--text2);">Delete "<strong>${escHtml(title)}</strong>"?</p>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteBug(${id})">Delete</button>`,
  });
}

async function deleteBug(id) {
  await API.deleteBug(id);
  Modal.close();
  toast('Bug deleted');
  renderBugs();
}
