// Workspaces Page
async function renderWorkspaces() {
  setTopbar('Workspaces', 'manage bug bounty programs');
  setTopbarActions(`
    <button class="btn btn-primary" onclick="showCreateWorkspace()">+ New Workspace</button>
    <button class="btn btn-ghost btn-sm" onclick="importWorkspace()" title="Import workspace JSON">Import</button>
  `);

  const content = document.getElementById('content');
  content.innerHTML = `<div id="ws-page-loading" style="color:var(--text3);font-size:13px;">Loading...</div>`;

  const workspaces = await API.getWorkspaces().catch(() => []);
  const current = getActiveWorkspace();

  if (!workspaces.length) {
    content.innerHTML = `
      <div class="empty-state">
        <h3>No Workspaces</h3>
        <p>Create your first workspace to get started.</p>
        <br>
        <button class="btn btn-primary" onclick="showCreateWorkspace()">+ New Workspace</button>
      </div>`;
    return;
  }

  content.innerHTML = `
    <div class="workspace-grid" id="ws-grid"></div>`;

  const grid = document.getElementById('ws-grid');
  for (const ws of workspaces) {
    const isActive = String(ws.id) === String(current);
    const card = document.createElement('div');
    card.className = 'workspace-card' + (isActive ? ' active' : '');
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3>${escHtml(ws.name)}</h3>
        ${isActive ? `<span class="badge badge-info" style="font-size:9px;">ACTIVE</span>` : ''}
      </div>
      <p>${escHtml(ws.description || 'No description')}</p>
      <div class="workspace-card-footer">
        <span class="text-xs text-dim mono">Created ${fmtDate(ws.created_at)}</span>
        <div style="display:flex;gap:6px;">
          ${!isActive ? `<button class="btn btn-ghost btn-sm" onclick="activateWorkspace(${ws.id},'${escHtml(ws.name)}')">Activate</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="API.exportWorkspace(${ws.id})" title="Export workspace JSON">Export</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteWorkspace(${ws.id},'${escHtml(ws.name)}')">Delete</button>
        </div>
      </div>`;
    grid.appendChild(card);
  }
}

function showCreateWorkspace() {
  Modal.open({
    title: 'New Workspace',
    body: `
      <div class="form-group">
        <label>Name</label>
        <input class="form-control" id="ws-name" placeholder="e.g., Example Corp Bug Bounty" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <input class="form-control" id="ws-desc" placeholder="Optional description or scope URL" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="createWorkspace()">Create</button>`,
  });
  document.getElementById('ws-name').addEventListener('keydown', e => { if (e.key === 'Enter') createWorkspace(); });
}

async function createWorkspace() {
  const name = document.getElementById('ws-name').value.trim();
  const desc = document.getElementById('ws-desc').value.trim();
  if (!name) { toast('Workspace name is required', 'error'); return; }
  try {
    const ws = await API.createWorkspace({ name, description: desc });
    Modal.close();
    toast(`Workspace "${ws.name}" created`, 'success');
    setActiveWorkspace(ws.id, ws.name);
    await refreshWorkspaceSelector();
    renderWorkspaces();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function activateWorkspace(id, name) {
  setActiveWorkspace(id, name);
  await refreshWorkspaceSelector();
  toast(`Switched to "${name}"`, 'success');
  renderWorkspaces();
}

function confirmDeleteWorkspace(id, name) {
  Modal.open({
    title: 'Delete Workspace',
    body: `<p style="color:var(--text2);">Are you sure you want to delete <strong>${escHtml(name)}</strong>?<br><br>
      <span style="color:var(--critical);font-size:12px;">⚠️ This will permanently delete all scope, subdomains, bugs, and checklist data.</span></p>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteWorkspace(${id})">Delete</button>`,
  });
}

async function deleteWorkspace(id) {
  try {
    await API.deleteWorkspace(id);
    if (String(getActiveWorkspace()) === String(id)) {
      setActiveWorkspace('', '');
    }
    Modal.close();
    toast('Workspace deleted');
    await refreshWorkspaceSelector();
    renderWorkspaces();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function isWorkspaceExport(data) {
  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && data.workspace);
}

function isScopeJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (Array.isArray(data?.target?.scope?.include)) return true;
  if (Array.isArray(data.targets) || Array.isArray(data.scope_items)) return true;
  return false;
}

function deriveWorkspaceName(fileName, data) {
  if (typeof data?.workspace?.name === 'string' && data.workspace.name.trim()) {
    return data.workspace.name.trim();
  }
  const base = String(fileName || 'Imported Scope')
    .replace(/\.[^.]+$/, '')
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return base || 'Imported Scope';
}

async function importWorkspace() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid import file: expected JSON object');
      }

      if (isWorkspaceExport(data)) {
        await API.importWorkspace(data);
        toast('Workspace imported!', 'success');
      } else if (isScopeJson(data)) {
        const workspaceName = deriveWorkspaceName(file.name, data);
        await API.uploadScope(file, workspaceName);
        toast(`Scope imported to workspace "${workspaceName}"`, 'success');
      } else {
        throw new Error('Unsupported JSON format for import');
      }

      await refreshWorkspaceSelector();
      renderWorkspaces();
    } catch (e) {
      toast('Import failed: ' + e.message, 'error');
    }
  };
  input.click();
}
