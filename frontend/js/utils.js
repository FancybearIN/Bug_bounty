// Utility helpers

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  setTimeout(() => el.className = '', 2800);
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function badgeSeverity(sev) {
  const s = (sev || '').toLowerCase();
  return `<span class="badge badge-${s}">${escHtml(sev)}</span>`;
}

function badgeStatus(status) {
  const key = (status || 'not tested').toLowerCase().replace(/\s+/g,'-');
  return `<span class="status-pill status-${key}">${escHtml(status)}</span>`;
}

function badgeMethod(method) {
  const m = (method || '').toLowerCase();
  return `<span class="method method-${m}">${escHtml(method)}</span>`;
}

function badgeType(type) {
  return `<span class="type-label type-${escHtml(type)}">${escHtml(type)}</span>`;
}

function statusDot(code) {
  const c = String(code || '');
  const cls = [200,201,204].includes(+c) ? '200'
            : [301,302,307,308].includes(+c) ? '301'
            : c === '403' ? '403'
            : (c.startsWith('4') || c.startsWith('5')) ? '500'
            : 'unknown';
  return `<span class="status-dot status-dot-${cls}"></span>`;
}

function fmtDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function requireWorkspace() {
  const wsId = getActiveWorkspace();
  if (!wsId) {
    document.getElementById('content').innerHTML = `
      <div class="no-ws-warning">
        <p>No workspace selected. <a href="#" onclick="App.navigate('workspaces')" style="color:var(--text2);text-decoration:underline;">Go to Workspaces</a> to create or select one.</p>
      </div>`;
    return null;
  }
  return wsId;
}

function getActiveWorkspace() {
  return localStorage.getItem('activeWorkspace') || '';
}

function setActiveWorkspace(id, name) {
  localStorage.setItem('activeWorkspace', id);
  localStorage.setItem('activeWorkspaceName', name || '');
  const sel = document.getElementById('ws-select');
  if (sel) sel.value = id;
}

function getActiveWorkspaceName() {
  return localStorage.getItem('activeWorkspaceName') || '';
}

function setActiveDomain(domain) {
  localStorage.setItem('activeDomain', domain || '');
}

function getActiveDomain() {
  return localStorage.getItem('activeDomain') || '';
}

function setActiveTargetId(targetId) {
  localStorage.setItem('activeTargetId', targetId ? String(targetId) : '');
}

function getActiveTargetId() {
  return localStorage.getItem('activeTargetId') || '';
}

function clearDomainContext() {
  setActiveDomain('');
  setActiveTargetId('');
}

async function refreshWorkspaceSelector() {
  const sel = document.getElementById('ws-select');
  const workspaces = await API.getWorkspaces();
  const current = getActiveWorkspace();
  sel.innerHTML = `<option value="">— Select Workspace —</option>` +
    workspaces.map(w => `<option value="${w.id}" ${w.id == current ? 'selected' : ''}>${escHtml(w.name)}</option>`).join('');
}

function setTopbar(title, subtitle = '') {
  document.getElementById('topbar-title').textContent = title;
  document.getElementById('topbar-subtitle').textContent = subtitle;
  document.getElementById('topbar-actions').innerHTML = '';
}

function setTopbarActions(html) {
  document.getElementById('topbar-actions').innerHTML = html;
}

// Inline text edit (double-click to edit)
function makeEditable(el, onSave) {
  el.style.cursor = 'text';
  el.title = 'Double-click to edit';
  el.addEventListener('dblclick', () => {
    const orig = el.textContent;
    el.contentEditable = 'true';
    el.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(el);
    el.style.outline = '1px solid var(--border2)';
    el.style.borderRadius = '3px';
    el.style.padding = '2px 4px';

    function finish(save) {
      el.contentEditable = 'false';
      el.style.outline = '';
      el.style.padding = '';
      if (save && el.textContent.trim() && el.textContent.trim() !== orig) {
        onSave(el.textContent.trim());
      } else {
        el.textContent = orig;
      }
    }

    el.addEventListener('blur', () => finish(true), { once: true });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }, { once: true });
  });
}

// Simple drag-over for upload zones
function setupDropZone(zone, onFile) {
  zone.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.onchange = () => { if (inp.files[0]) onFile(inp.files[0]); };
    inp.click();
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}
