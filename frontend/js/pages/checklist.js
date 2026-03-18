// Checklist Page
async function renderChecklist() {
  const wsId = requireWorkspace();
  if (!wsId) return;

  setTopbar('Testing Checklist', `${getActiveWorkspaceName()} — OWASP-based test coverage`);
  setTopbarActions(`
    <button class="btn btn-ghost btn-sm" onclick="showAddChecklistItem()">+ Custom Item</button>
    <button class="btn btn-danger btn-sm" onclick="confirmResetChecklist()">Reset All</button>
  `);

  document.getElementById('content').innerHTML = `<div style="color:var(--text3);font-size:13px;">Loading checklist...</div>`;

  const data = await API.getChecklist(wsId).catch(() => ({ categories: {}, total: 0, done: 0 }));
  const { categories, total, done } = data;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  const sevFilter = { 'Critical': 0, 'High': 0, 'Medium': 0, 'Low': 0 };
  const sevDone   = { 'Critical': 0, 'High': 0, 'Medium': 0, 'Low': 0 };

  for (const items of Object.values(categories)) {
    for (const item of items) {
      sevFilter[item.severity] = (sevFilter[item.severity] || 0) + 1;
      if (item.done) sevDone[item.severity] = (sevDone[item.severity] || 0) + 1;
    }
  }

  let html = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${done} / ${total}</div>
        <div class="stat-label">Tested</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
      </div>
      <div class="stat-card"><div class="stat-value" style="color:var(--critical);">${sevDone['Critical']}/${sevFilter['Critical']}</div><div class="stat-label">Critical</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--high);">${sevDone['High']}/${sevFilter['High']}</div><div class="stat-label">High</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--medium);">${sevDone['Medium']}/${sevFilter['Medium']}</div><div class="stat-label">Medium</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--low);">${sevDone['Low']}/${sevFilter['Low']}</div><div class="stat-label">Low</div></div>
    </div>
    <div class="filter-bar" style="margin-bottom:16px;">
      <input id="cl-search" placeholder="🔍  Filter checks..." oninput="filterChecklist()" style="max-width:280px;" />
      <select id="cl-sev-filter" onchange="filterChecklist()">
        <option value="">All Severities</option>
        <option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
      </select>
      <select id="cl-status-filter" onchange="filterChecklist()">
        <option value="">All</option>
        <option value="done">Done</option>
        <option value="pending">Pending</option>
      </select>
    </div>
    <div id="checklist-body">`;

  for (const [cat, items] of Object.entries(categories)) {
    const catDone = items.filter(i => i.done).length;
    const catPct = items.length > 0 ? Math.round(catDone / items.length * 100) : 0;

    html += `
      <div class="checklist-category" data-cat="${escHtml(cat)}">
        <div class="checklist-cat-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>${escHtml(cat)}</span>
          <span style="font-weight:400;font-size:10px;">${catDone}/${items.length} · ${catPct}%</span>
        </div>
        ${items.map(item => `
          <div class="checklist-item ${item.done ? 'done' : ''}" id="cl-item-${item.id}" data-sev="${item.severity}" data-done="${item.done ? '1' : '0'}"
               data-search="${escHtml(item.title.toLowerCase())}" onclick="toggleChecklistItem(${item.id}, ${item.done ? 0 : 1})">
            <div class="checklist-item-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="checklist-item-title">${escHtml(item.title)}</div>
            ${badgeSeverity(item.severity)}
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();confirmDeleteChecklistItem(${item.id})" style="margin-left:4px;opacity:0.4;flex-shrink:0;">✕</button>
          </div>`).join('')}
      </div>`;
  }

  html += `</div>`;
  document.getElementById('content').innerHTML = html;
}

async function toggleChecklistItem(id, done) {
  try {
    await API.toggleChecklist(id, done);
    const el = document.getElementById(`cl-item-${id}`);
    if (el) {
      el.classList.toggle('done', !!done);
      el.dataset.done = done ? '1' : '0';
      el.querySelector('.checklist-item-check').innerHTML = done
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
        : '';
      // Update onclick to toggle the opposite
      el.onclick = () => toggleChecklistItem(id, done ? 0 : 1);
    }
    // Refresh counter in header
    refreshChecklistCatHeaders();
  } catch (e) { toast(e.message, 'error'); }
}

function refreshChecklistCatHeaders() {
  document.querySelectorAll('.checklist-category').forEach(cat => {
    const items = cat.querySelectorAll('.checklist-item');
    const done = cat.querySelectorAll('.checklist-item.done').length;
    const total = items.length;
    const pct = total > 0 ? Math.round(done / total * 100) : 0;
    const header = cat.querySelector('.checklist-cat-title span:last-child');
    if (header) header.textContent = `${done}/${total} · ${pct}%`;
  });
}

function filterChecklist() {
  const q = (document.getElementById('cl-search')?.value || '').toLowerCase();
  const sev = document.getElementById('cl-sev-filter')?.value || '';
  const status = document.getElementById('cl-status-filter')?.value || '';

  document.querySelectorAll('.checklist-item').forEach(item => {
    const matchQ = !q || item.dataset.search?.includes(q);
    const matchSev = !sev || item.dataset.sev === sev;
    const matchStatus = !status || (status === 'done' ? item.dataset.done === '1' : item.dataset.done === '0');
    item.style.display = (matchQ && matchSev && matchStatus) ? '' : 'none';
  });

  // Hide empty categories
  document.querySelectorAll('.checklist-category').forEach(cat => {
    const visible = [...cat.querySelectorAll('.checklist-item')].some(i => i.style.display !== 'none');
    cat.style.display = visible ? '' : 'none';
  });
}

function showAddChecklistItem() {
  const wsId = getActiveWorkspace();
  Modal.open({
    title: 'Add Custom Checklist Item',
    body: `
      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <input class="form-control" id="cl-add-cat" placeholder="e.g., Authentication" list="cl-cat-list" />
          <datalist id="cl-cat-list">
            <option>Authentication</option><option>IDOR / Authorization</option><option>Injection</option>
            <option>XSS</option><option>SSRF</option><option>File Upload</option><option>Business Logic</option>
            <option>API Security</option><option>Cryptography</option><option>CSRF / Headers</option>
            <option>Subdomain / DNS</option><option>Deserialization</option><option>Path Traversal</option><option>RCE</option>
          </datalist>
        </div>
        <div class="form-group">
          <label>Severity</label>
          <select class="form-control" id="cl-add-sev">
            <option>Critical</option><option>High</option><option selected>Medium</option><option>Low</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Title</label>
        <input class="form-control" id="cl-add-title" placeholder="What to test for..." />
      </div>
      <div class="form-group">
        <label>Description (optional)</label>
        <input class="form-control" id="cl-add-desc" placeholder="Additional context" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="addChecklistItem()">Add</button>`,
  });
}

async function addChecklistItem() {
  const wsId = getActiveWorkspace();
  const category = document.getElementById('cl-add-cat').value.trim();
  const severity = document.getElementById('cl-add-sev').value;
  const title = document.getElementById('cl-add-title').value.trim();
  const description = document.getElementById('cl-add-desc').value.trim();
  if (!category || !title) { toast('Category and title required', 'error'); return; }
  try {
    await API.addChecklistItem({ workspace_id: wsId, category, severity, title, description });
    Modal.close();
    toast('Item added', 'success');
    renderChecklist();
  } catch (e) { toast(e.message, 'error'); }
}

function confirmResetChecklist() {
  Modal.open({
    title: 'Reset Checklist',
    body: `<p style="color:var(--text2);">Mark all checklist items as <strong>not done</strong>?<br><br>This resets your testing progress for this workspace.</p>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" onclick="resetChecklist()">Reset All</button>`,
  });
}

async function resetChecklist() {
  const wsId = getActiveWorkspace();
  await API.resetChecklist(wsId);
  Modal.close();
  toast('Checklist reset', 'success');
  renderChecklist();
}

function confirmDeleteChecklistItem(id) {
  Modal.open({
    title: 'Delete Item',
    body: `<p style="color:var(--text2);">Delete this checklist item?</p>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteChecklistItem(${id})">Delete</button>`,
  });
}

async function deleteChecklistItem(id) {
  await API.deleteChecklistItem(id);
  Modal.close();
  toast('Item deleted');
  renderChecklist();
}
