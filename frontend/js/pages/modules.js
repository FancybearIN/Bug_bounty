// Modules Page
let _moduleExpandState = {};
let _moduleSubdomains = [];

function getModuleFiltersFromUI() {
  return {
    method: document.getElementById('mod-filter-method')?.value || '',
    param: document.getElementById('mod-filter-param')?.value.trim() || '',
    module_id: document.getElementById('mod-filter-module')?.value || '',
    subdomain_id: document.getElementById('mod-filter-subdomain')?.value || '',
  };
}

function applyModuleFilters() {
  renderModules();
}

async function renderModules() {
  const wsId = requireWorkspace();
  if (!wsId) return;

  setTopbar('Modules', `${getActiveWorkspaceName()} — endpoint mapping`);
  setTopbarActions(`<button class="btn btn-primary btn-sm" onclick="showAddModule(null)">+ Add Module</button>`);

  document.getElementById('content').innerHTML = `<div style="color:var(--text3);font-size:13px;">Loading modules...</div>`;

  const [subdomains, baseTree] = await Promise.all([
    API.getSubdomains(wsId).catch(() => []),
    API.getModules(wsId).catch(() => []),
  ]);
  _moduleSubdomains = subdomains;

  const moduleOptions = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      moduleOptions.push({ id: n.id, name: n.name });
      walk(n.children || []);
    }
  };
  walk(baseTree);

  const filters = getModuleFiltersFromUI();
  const tree = await API.getModules(wsId, filters).catch(() => []);

  const methodOpt = (m) => `<option value="${m}" ${filters.method === m ? 'selected' : ''}>${m}</option>`;
  const moduleOpt = moduleOptions.map((m) => `<option value="${m.id}" ${String(filters.module_id) === String(m.id) ? 'selected' : ''}>${escHtml(m.name)}</option>`).join('');
  const subdomainOpt = _moduleSubdomains.map((s) => `<option value="${s.id}" ${String(filters.subdomain_id) === String(s.id) ? 'selected' : ''}>${escHtml(s.value)}</option>`).join('');

  let html = '';
  html += `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Endpoint Filters</div>
      <div class="form-row">
        <div class="form-group">
          <label>Method</label>
          <select class="form-control" id="mod-filter-method" onchange="applyModuleFilters()">
            <option value="">All</option>
            ${methodOpt('GET')}${methodOpt('POST')}${methodOpt('PUT')}${methodOpt('PATCH')}${methodOpt('DELETE')}
          </select>
        </div>
        <div class="form-group">
          <label>Param</label>
          <input class="form-control" id="mod-filter-param" value="${escHtml(filters.param || '')}" placeholder="token" oninput="applyModuleFilters()" />
        </div>
        <div class="form-group">
          <label>Module</label>
          <select class="form-control" id="mod-filter-module" onchange="applyModuleFilters()">
            <option value="">All</option>
            ${moduleOpt}
          </select>
        </div>
        <div class="form-group">
          <label>Subdomain</label>
          <select class="form-control" id="mod-filter-subdomain" onchange="applyModuleFilters()">
            <option value="">All</option>
            ${subdomainOpt}
          </select>
        </div>
      </div>
    </div>`;

  if (tree.length === 0) {
    html += `
      <div class="empty-state">
        <h3>No Modules</h3>
        <p>Map your application structure: Module → Submodule → Endpoints.</p>
        <br><button class="btn btn-primary" onclick="showAddModule(null)">+ Add First Module</button>
      </div>`;
  } else {
    for (const mod of tree) {
      html += renderModuleNode(mod, wsId);
    }
  }

  document.getElementById('content').innerHTML = html;
}

function renderModuleNode(mod, wsId) {
  const isOpen = _moduleExpandState[mod.id] !== false; // default open
  const epCount = getTotalEndpoints(mod);
  const testedCount = getTotalTestedEndpoints(mod);
  const pct = epCount > 0 ? Math.round(testedCount / epCount * 100) : 0;

  return `
    <div class="module-tree-root" id="mod-${mod.id}">
      <div class="module-node">
        <div class="module-header" onclick="toggleModule(${mod.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition:transform 0.15s;${isOpen ? 'transform:rotate(90deg)' : ''}" id="mod-caret-${mod.id}"><polyline points="9 18 15 12 9 6"/></svg>
          <h3>${escHtml(mod.name)}</h3>
          <span class="badge badge-info" style="font-size:9px;">${mod.children.length} submodules · ${epCount} endpoints</span>
          <span class="text-xs text-dim" style="font-family:var(--mono);">${pct}% tested</span>
          <div style="display:flex;gap:4px;margin-left:auto;">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();showAddModule(${mod.id})" title="Add submodule">+ Sub</button>
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();showAddEndpointModal(${mod.id})" title="Add endpoint">+ EP</button>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmDeleteModule(${mod.id})">✕</button>
          </div>
        </div>
        ${pct > 0 ? `<div class="progress-bar" style="margin:0 14px 8px;"><div class="progress-fill" style="width:${pct}%;"></div></div>` : ''}
        <div class="module-body" id="mod-body-${mod.id}" style="${isOpen ? '' : 'display:none;'}">
          ${mod.children.map(sub => renderSubmoduleNode(sub)).join('')}
          ${renderEndpointList(mod)}
          <div class="add-inline" style="margin-top:4px;">
            <input id="esub-name-${mod.id}" placeholder="New submodule name..." />
            <button class="btn btn-ghost btn-sm" onclick="quickAddModule(${mod.id})">Add Submodule</button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderSubmoduleNode(sub) {
  const isOpen = _moduleExpandState[`sub_${sub.id}`] !== false;
  const epCount = sub.endpoints.length;
  const testedCount = sub.endpoints.filter(e => e.tested).length;
  const pct = epCount > 0 ? Math.round(testedCount / epCount * 100) : 0;

  return `
    <div class="submodule-node" id="submod-${sub.id}">
      <div class="submodule-header" onclick="toggleSubmodule(${sub.id})">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition:transform 0.15s;${isOpen ? 'transform:rotate(90deg)' : ''}" id="submod-caret-${sub.id}"><polyline points="9 18 15 12 9 6"/></svg>
        <h4>${escHtml(sub.name)}</h4>
        <span class="text-xs text-dim">${epCount} endpoints ${pct > 0 ? `· ${pct}% tested` : ''}</span>
        <div style="display:flex;gap:4px;margin-left:auto;">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();showAddEndpointModal(${sub.id})" title="Add endpoint">+ EP</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmDeleteModule(${sub.id})">✕</button>
        </div>
      </div>
      <div class="submodule-body" id="submod-body-${sub.id}" style="${isOpen ? '' : 'display:none;'}">
        ${pct > 0 ? `<div class="progress-bar" style="margin:4px 10px 8px;"><div class="progress-fill" style="width:${pct}%;"></div></div>` : ''}
        ${renderEndpointList(sub)}
        <div class="add-inline">
          <select id="epmethod-quick-${sub.id}" style="flex:0.5;">
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
          </select>
          <input id="eppath-quick-${sub.id}" placeholder="/api/endpoint" />
          <button class="btn btn-ghost btn-sm" onclick="quickAddEndpoint(${sub.id})">Add</button>
        </div>
      </div>
    </div>`;
}

function renderEndpointList(mod) {
  if ((mod.endpoints?.length || 0) === 0) return '';

  const renderParams = (ep) => {
    if ((ep.parameters?.length || 0) === 0) return '';
    const tags = ep.parameters.map((p) => `<span class="tag">${escHtml(p)}</span>`).join('');
    return `<div style="display:flex;flex-wrap:wrap;gap:3px;">${tags}</div>`;
  };

  return `<div style="padding:4px 8px;">
    ${mod.endpoints.map(ep => `
      <div class="endpoint-row" id="ep-${ep.id}">
        <div class="endpoint-tested ${ep.tested ? 'checked' : ''}" title="${ep.tested ? 'Tested' : 'Not tested'}" onclick="toggleEndpointTested(${mod.id}, ${ep.id}, ${ep.tested ? 0 : 1})">
          ${ep.tested ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
        </div>
        ${badgeMethod(ep.method)}
        <div class="endpoint-path" title="${escHtml(ep.notes||'')}">${escHtml(ep.path)}</div>
        ${ep.subdomain_value ? `<span class="tag">${escHtml(ep.subdomain_value)}</span>` : ''}
        ${renderParams(ep)}
        <div style="display:flex;gap:4px;margin-left:auto;">
          <button class="btn btn-ghost btn-sm" onclick="showEditEndpoint(${mod.id}, ${ep.id})" title="Edit">✎</button>
          <button class="btn btn-danger btn-sm" onclick="deleteEndpoint(${mod.id}, ${ep.id})">✕</button>
        </div>
      </div>`).join('')}
    </div>`;
}

function getTotalEndpoints(mod) {
  let count = mod.endpoints?.length || 0;
  for (const sub of mod.children || []) count += sub.endpoints?.length || 0;
  return count;
}

function getTotalTestedEndpoints(mod) {
  let count = (mod.endpoints || []).filter(e => e.tested).length;
  for (const sub of mod.children || []) count += (sub.endpoints || []).filter(e => e.tested).length;
  return count;
}

function toggleModule(id) {
  const body = document.getElementById(`mod-body-${id}`);
  const caret = document.getElementById(`mod-caret-${id}`);
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  caret.style.transform = isOpen ? '' : 'rotate(90deg)';
  _moduleExpandState[id] = !isOpen;
}

function toggleSubmodule(id) {
  const body = document.getElementById(`submod-body-${id}`);
  const caret = document.getElementById(`submod-caret-${id}`);
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  caret.style.transform = isOpen ? '' : 'rotate(90deg)';
  _moduleExpandState[`sub_${id}`] = !isOpen;
}

function showAddModule(parentId) {
  const isSubmodule = parentId !== null;
  Modal.open({
    title: isSubmodule ? 'Add Submodule' : 'Add Module',
    body: `
      <div class="form-group">
        <label>${isSubmodule ? 'Submodule' : 'Module'} Name</label>
        <input class="form-control" id="mod-name-input" placeholder="e.g., Authentication, IDOR, Admin Panel" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="addModule(${parentId})">Add</button>`,
  });
  document.getElementById('mod-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') addModule(parentId); });
}

async function addModule(parentId) {
  const name = document.getElementById('mod-name-input').value.trim();
  const wsId = getActiveWorkspace();
  if (!name) { toast('Name required', 'error'); return; }
  try {
    await API.createModule({ workspace_id: wsId, name, parent_id: parentId });
    Modal.close();
    toast('Module added', 'success');
    renderModules();
  } catch (e) { toast(e.message, 'error'); }
}

async function quickAddModule(parentId) {
  const input = document.getElementById(`esub-name-${parentId}`);
  const name = input.value.trim();
  const wsId = getActiveWorkspace();
  if (!name) return;
  try {
    await API.createModule({ workspace_id: wsId, name, parent_id: parentId });
    toast('Submodule added', 'success');
    renderModules();
  } catch (e) { toast(e.message, 'error'); }
}

async function quickAddEndpoint(modId) {
  const method = document.getElementById(`epmethod-quick-${modId}`)?.value || 'GET';
  const path = document.getElementById(`eppath-quick-${modId}`)?.value?.trim() || '';
  if (!path) return;
  try {
    await API.addEndpoint(modId, { method, path });
    toast('Endpoint added', 'success');
    renderModules();
  } catch (e) { toast(e.message, 'error'); }
}

function showAddEndpointModal(modId) {
  const subdomainOptions = _moduleSubdomains.map((sd) => `<option value="${sd.id}">${escHtml(sd.value)}</option>`).join('');
  Modal.open({
    title: 'Add Endpoint',
    body: `
      <div class="form-row">
        <div class="form-group" style="flex:0.5;">
          <label>Method</label>
          <select class="form-control" id="ep-method">
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>OPTIONS</option><option>HEAD</option>
          </select>
        </div>
        <div class="form-group">
          <label>Path</label>
          <input class="form-control" id="ep-path" placeholder="/api/v1/users/:id" />
        </div>
      </div>
      <div class="form-group">
        <label>Parameters (comma-separated)</label>
        <input class="form-control" id="ep-params" placeholder="id, page, limit" />
      </div>
      <div class="form-group">
        <label>Subdomain (optional)</label>
        <select class="form-control" id="ep-subdomain-id">
          <option value="">Not scoped</option>
          ${subdomainOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Notes</label>
        <input class="form-control" id="ep-notes" placeholder="Check for SQLi, IDOR, etc." />
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="addEndpointModal(${modId})">Add Endpoint</button>`,
  });
}

async function addEndpointModal(modId) {
  const method = document.getElementById('ep-method').value;
  const path = document.getElementById('ep-path').value.trim();
  const params = document.getElementById('ep-params').value.split(',').map(p => p.trim()).filter(Boolean);
  const subdomainRaw = document.getElementById('ep-subdomain-id').value;
  const subdomain_id = subdomainRaw ? Number(subdomainRaw) : null;
  const notes = document.getElementById('ep-notes').value.trim();
  if (!path) { toast('Path required', 'error'); return; }
  try {
    await API.addEndpoint(modId, { method, path, parameters: params, notes, subdomain_id });
    Modal.close();
    toast('Endpoint added', 'success');
    renderModules();
  } catch (e) { toast(e.message, 'error'); }
}

function showEditEndpoint(modId, epId) {
  // Find current endpoint from DOM context — quick & simple: refetch
  API.getModules(getActiveWorkspace()).then(tree => {
    let ep = null;
    for (const m of tree) {
      ep = ep || m.endpoints?.find(e => e.id == epId);
      for (const s of m.children || []) ep = ep || s.endpoints?.find(e => e.id == epId);
    }
    if (!ep) return;
    Modal.open({
      title: 'Edit Endpoint',
      body: `
        <div class="form-row">
          <div class="form-group" style="flex:0.5;">
            <label>Method</label>
            <select class="form-control" id="ep-edit-method">
              ${['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].map(m => `<option ${m===ep.method?'selected':''}>${m}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Path</label>
            <input class="form-control" id="ep-edit-path" value="${escHtml(ep.path)}" />
          </div>
        </div>
        <div class="form-group">
          <label>Parameters (comma-separated)</label>
          <input class="form-control" id="ep-edit-params" value="${escHtml((ep.parameters||[]).join(', '))}" />
        </div>
        <div class="form-group">
          <label>Subdomain (optional)</label>
          <select class="form-control" id="ep-edit-subdomain-id">
            <option value="">Not scoped</option>
            ${_moduleSubdomains.map((sd) => `<option value="${sd.id}" ${Number(ep.subdomain_id) === Number(sd.id) ? 'selected' : ''}>${escHtml(sd.value)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <input class="form-control" id="ep-edit-notes" value="${escHtml(ep.notes||'')}" />
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="saveEditEndpoint(${modId},${epId})">Save</button>`,
    });
  });
}

async function saveEditEndpoint(modId, epId) {
  const method = document.getElementById('ep-edit-method').value;
  const path = document.getElementById('ep-edit-path').value.trim();
  const params = document.getElementById('ep-edit-params').value.split(',').map(p => p.trim()).filter(Boolean);
  const subdomainRaw = document.getElementById('ep-edit-subdomain-id').value;
  const subdomain_id = subdomainRaw ? Number(subdomainRaw) : null;
  const notes = document.getElementById('ep-edit-notes').value.trim();
  try {
    await API.updateEndpoint(modId, epId, { method, path, parameters: params, notes, subdomain_id });
    Modal.close();
    toast('Endpoint updated', 'success');
    renderModules();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleEndpointTested(modId, epId, tested) {
  try {
    await API.updateEndpoint(modId, epId, { tested });
    renderModules();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteEndpoint(modId, epId) {
  await API.deleteEndpoint(modId, epId);
  toast('Endpoint deleted');
  renderModules();
}

function confirmDeleteModule(id) {
  Modal.open({
    title: 'Delete Module',
    body: `<p style="color:var(--text2);">Delete this module and all its submodules/endpoints?<br><br><span style="color:var(--critical);font-size:12px;">This cannot be undone.</span></p>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteModule(${id})">Delete</button>`,
  });
}

async function deleteModule(id) {
  await API.deleteModule(id);
  Modal.close();
  toast('Deleted');
  renderModules();
}
