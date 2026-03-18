// Subdomains Page + Detail Panel
let _subdomainDetailId = null;

function renderTreeNodeMap(nodeMap, level = 0) {
  const keys = Object.keys(nodeMap || {}).sort((a, b) => a.localeCompare(b));
  if (!keys.length) return '<div style="color:var(--text3);font-size:12px;">No nodes</div>';

  return `<ul style="list-style:none;margin:${level === 0 ? '0' : '0 0 0 12px'};padding:0;">
    ${keys.map((domain) => {
      const node = nodeMap[domain] || {};
      const hasChildren = Object.keys(node.children || {}).length > 0;
      const label = node.id
        ? `<button class="btn btn-ghost btn-sm" style="padding:2px 6px;" onclick="openSubdomainDetail(${node.id})">${escHtml(domain)}</button>`
        : `<span class="text-mono">${escHtml(domain)}</span>`;

      if (!hasChildren) {
        return `<li style="margin:3px 0;">${label}</li>`;
      }

      return `<li style="margin:3px 0;">
        <details>
          <summary style="cursor:pointer;">${label}</summary>
          ${renderTreeNodeMap(node.children, level + 1)}
        </details>
      </li>`;
    }).join('')}
  </ul>`;
}

function renderSubdomainTreeCard(treeObj) {
  const roots = Object.keys(treeObj || {}).sort((a, b) => a.localeCompare(b));
  if (!roots.length) {
    return `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-title">Subdomain Tree</div>
        <p style="color:var(--text3);font-size:12px;">No tree data available.</p>
      </div>`;
  }

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Subdomain Tree View</div>
      ${roots.map((root) => {
        const rootNode = treeObj[root] || { count: 0, children: {} };
        return `
          <details open style="margin-bottom:8px;">
            <summary class="text-mono" style="cursor:pointer;">${escHtml(root)} <span style="color:var(--text3);font-size:11px;">(${rootNode.count || 0})</span></summary>
            <div style="margin-top:6px;">${renderTreeNodeMap(rootNode.children, 1)}</div>
          </details>`;
      }).join('')}
    </div>`;
}

function renderSubdomainInventory(subdomains) {
  if (!subdomains.length) {
    return `
      <div class="card">
        <div class="card-title">Subdomain Inventory</div>
        <p style="color:var(--text3);font-size:12px;">No subdomains discovered yet.</p>
      </div>`;
  }

  return `
    <div class="card" style="margin-top:12px;">
      <div class="card-title">Subdomain Inventory</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Subdomain</th><th>Target ID</th><th>Tags</th><th></th></tr></thead>
          <tbody>
            ${subdomains.map((sd) => `
              <tr>
                <td class="text-mono">${escHtml(sd.value)}</td>
                <td>${sd.target_id ? `<span class="badge badge-info">${escHtml(String(sd.target_id))}</span>` : '<span style="color:var(--text3);">—</span>'}</td>
                <td>${Array.isArray(sd.tags) && sd.tags.length ? sd.tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join(' ') : '<span style="color:var(--text3);">—</span>'}</td>
                <td style="white-space:nowrap;text-align:right;">
                  <button class="btn btn-ghost btn-sm" onclick="openSubdomainDetail(${sd.id})">Detail</button>
                  <button class="btn btn-ghost btn-sm" onclick="showEditTags(${sd.id})">Tags</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderSubdomains() {
  const wsId = requireWorkspace();
  if (!wsId) return;

  try {
    setTopbar('Subdomains', `${getActiveWorkspaceName()} — subdomain tree view`);
    setTopbarActions(`
      <button class="btn btn-ghost btn-sm" onclick="showAddSubdomain()">+ Add</button>
      <button class="btn btn-primary btn-sm" onclick="showUploadSubdomains()">Upload TXT</button>
    `);

    document.getElementById('content').innerHTML = `<div style="color:var(--text3);font-size:13px;">Loading subdomains...</div>`;

    const [subdomains, treePayload] = await Promise.all([
      API.getSubdomains(wsId).catch(() => []),
      API.getSubdomainTree(wsId).catch(() => ({ tree: {} })),
    ]);

    const tree = treePayload?.tree || {};

    document.getElementById('content').innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-value">${subdomains.length}</div><div class="stat-label">Total Subdomains</div></div>
      </div>

      ${renderSubdomainTreeCard(tree)}

      ${renderSubdomainInventory(subdomains)}`;
  } catch (e) {
    console.error('renderSubdomains error:', e);
    document.getElementById('content').innerHTML = `<div class="card"><div class="card-title">Subdomains</div><p style="color:var(--critical);font-size:12px;">Failed to render subdomains: ${escHtml(e.message || 'unknown error')}</p></div>`;
  }
}

async function showEditTags(sdId) {
  const sd = await API.getSubdomain(sdId).catch(() => null);
  if (!sd) {
    toast('Subdomain not found', 'error');
    return;
  }

  const initial = Array.isArray(sd.tags) ? sd.tags.join(', ') : '';
  Modal.open({
    title: `Edit Tags — ${sd.value}`,
    body: `
      <div class="form-group">
        <label>Tags (comma-separated)</label>
        <input class="form-control" id="sd-tags-input" value="${escHtml(initial)}" placeholder="prod, login, priority" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSubdomainTags(${sdId})">Save</button>`,
  });
}

async function saveSubdomainTags(sdId) {
  const value = document.getElementById('sd-tags-input')?.value || '';
  const tags = [...new Set(value.split(',').map((t) => t.trim()).filter(Boolean))];
  try {
    await API.updateSubdomain(sdId, { tags });
    Modal.close();
    toast('Tags updated', 'success');
    renderSubdomains();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function toggleCollapsible(header) {
  const body = header.nextElementSibling;
  const caret = header.querySelector('.caret');
  const isOpen = !body.classList.contains('collapsed');
  body.classList.toggle('collapsed', isOpen);
  caret.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function showAddSubdomain() {
  Modal.open({
    title: 'Add Subdomain',
    body: `
      <div class="form-group">
        <label>Subdomain</label>
        <input class="form-control" id="sd-value" placeholder="sub.example.com" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="addSubdomainSingle()">Add</button>`,
  });
  document.getElementById('sd-value').addEventListener('keydown', e => { if (e.key === 'Enter') addSubdomainSingle(); });
}

async function addSubdomainSingle() {
  const value = String(document.getElementById('sd-value')?.value || '').trim();
  const workspace_id = Number(getActiveWorkspace());
  if (!Number.isInteger(workspace_id) || workspace_id <= 0) {
    toast('Select a workspace first', 'error');
    return;
  }
  if (!value) {
    toast('Value required', 'error');
    return;
  }

  try {
    console.log({ workspace_id, value });
    await API.addSubdomain({ workspace_id, value });
    Modal.close();
    toast('Subdomain added', 'success');
    renderSubdomains();
  } catch (e) { toast(e.message, 'error'); }
}

function showUploadSubdomains() {
  Modal.open({
    title: 'Upload Subdomain List',
    body: `
      <p style="color:var(--text3);font-size:12px;margin-bottom:16px;">
        Plain TXT file with one subdomain per line. Duplicates are ignored.
      </p>
      <div class="upload-zone" id="sd-upload-zone">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p>Click or drag & drop subdomain TXT here</p>
        <small>subdomains.txt · subs.txt</small>
      </div>
      <div id="sd-upload-result" style="margin-top:12px;font-size:12px;"></div>`,
    footer: `<button class="btn btn-ghost" onclick="Modal.close()">Close</button>`,
  });
  setupDropZone(document.getElementById('sd-upload-zone'), async (file) => {
    const wsId = getActiveWorkspace();
    try {
      const r = await API.uploadSubdomains(wsId, file);
      document.getElementById('sd-upload-result').innerHTML = `<span style="color:var(--success);">✓ ${r.inserted} new subdomains added (${r.total} total)</span>`;
      toast(`${r.inserted} subdomains imported`, 'success');
      setTimeout(() => { Modal.close(); renderSubdomains(); }, 1000);
    } catch (e) {
      document.getElementById('sd-upload-result').innerHTML = `<span style="color:var(--critical);">Error: ${escHtml(e.message)}</span>`;
    }
  });
}

// ── Detail Panel ──────────────────────────────────────────

async function openSubdomainDetail(id) {
  _subdomainDetailId = id;
  const panel = document.getElementById('detail-panel');
  panel.classList.add('open');

  const sd = await API.getSubdomain(id).catch(() => null);
  if (!sd) return;

  document.getElementById('detail-title').textContent = sd.value;
  const code = sd.httpx_data?.status;
  document.getElementById('detail-subtitle').innerHTML = code
    ? `${statusDot(code)} <span style="font-family:var(--mono);font-size:11px;">${code} ${sd.httpx_data?.title || ''}</span>`
    : 'No HTTPX data yet';

  renderHTTPXTab(sd);
  renderDirsearchTab(sd);
  renderWaybackTab(sd);
  renderParamsTab(sd);
  renderSubdomainJobs(sd.id);
}

function renderHTTPXTab(sd) {
  const h = sd.httpx_data || {};
  const el = document.getElementById('dtab-httpx');
  let statusColor = 'var(--critical)';
  if (h.status < 400) statusColor = 'var(--success)';
  else if (h.status === 403) statusColor = 'var(--high)';

  let tlsValidText = '—';
  if (h.tls) tlsValidText = h.tls.valid ? '✓ Valid' : '✗ Invalid';
  const controls = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Tool Control Panel</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" onclick="runDirsearchTool(${sd.id})">Run Dirsearch</button>
        <button class="btn btn-ghost btn-sm" onclick="runWaybackTool(${sd.id})">Run Wayback</button>
        <button class="btn btn-ghost btn-sm" onclick="runParamsTool(${sd.id})">Run Param Discovery</button>
        <button class="btn btn-primary btn-sm" onclick="showRunSelectedTools(${sd.id})">Run Selected Tools</button>
      </div>
      <div id="subdomain-jobs" style="margin-top:12px;"></div>
    </div>`;

  if (!Object.keys(h).length || !h.status) {
    el.innerHTML = `
      ${controls}
      <div class="empty-state" style="padding:24px 0;">
        <h3>No HTTPX Data</h3>
        <p>Add HTTPX results manually.</p>
      </div>
      <div class="card mt-16">
        <div class="card-title">Add HTTPX Data</div>
        ${httpxForm(sd)}
      </div>`;
  } else {
    el.innerHTML = `
      ${controls}
      <div class="card">
        <div class="card-title">HTTPX Results</div>
        <table style="width:100%;">
          <tbody>
            ${httpxRow('Status', `<span style="font-family:var(--mono);font-weight:600;color:${statusColor};">${h.status}</span>`)}
            ${httpxRow('Title', h.title || '—')}
            ${httpxRow('IP', h.ip || '—')}
            ${httpxRow('Ports', Array.isArray(h.ports) ? h.ports.join(', ') : (h.ports || '—'))}
            ${httpxRow('Tech Stack', Array.isArray(h.tech) ? h.tech.join(', ') : (h.tech || '—'))}
            ${httpxRow('TLS Issuer', h.tls?.issuer || '—')}
            ${httpxRow('TLS Valid', tlsValidText)}
          </tbody>
        </table>
        <div class="separator"></div>
        <div class="card-title">Edit HTTPX Data</div>
        ${httpxForm(sd)}
      </div>`;
  }
}

async function renderSubdomainJobs(subdomainId) {
  const el = document.getElementById('subdomain-jobs');
  if (!el) return;

  try {
    const jobs = await API.getSubdomainJobs(subdomainId);
    if (!Array.isArray(jobs) || !jobs.length) {
      el.innerHTML = '<div style="color:var(--text3);font-size:12px;">No tool jobs yet.</div>';
      return;
    }

    const rows = jobs.slice(0, 12).map((j) => `
      <tr>
        <td class="text-mono">${escHtml(j.tool)}</td>
        <td>${badgeStatus(j.status)}</td>
        <td class="text-mono">${escHtml(j.started_at || '—')}</td>
        <td class="text-mono">${escHtml(j.finished_at || '—')}</td>
      </tr>`).join('');

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tool</th><th>Status</th><th>Started</th><th>Finished</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--critical);font-size:12px;">${escHtml(e.message)}</div>`;
  }
}

async function runDirsearchTool(subdomainId) {
  try {
    await API.runDirsearch(subdomainId);
    toast('Dirsearch completed', 'success');
    if (_subdomainDetailId === subdomainId) openSubdomainDetail(subdomainId);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function runWaybackTool(subdomainId) {
  try {
    await API.runWayback(subdomainId);
    toast('Wayback completed', 'success');
    if (_subdomainDetailId === subdomainId) openSubdomainDetail(subdomainId);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function runParamsTool(subdomainId) {
  try {
    await API.runParamsDiscovery(subdomainId);
    toast('Param discovery completed', 'success');
    if (_subdomainDetailId === subdomainId) openSubdomainDetail(subdomainId);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function showRunSelectedTools(subdomainId) {
  Modal.open({
    title: 'Run Selected Tools',
    body: `
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px;"><input type="checkbox" id="tool-dirsearch" checked /> Dirsearch</label>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px;"><input type="checkbox" id="tool-wayback" checked /> Wayback</label>
      <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="tool-params" checked /> Param Discovery</label>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="runSelectedTools(${subdomainId})">Run</button>`,
  });
}

async function runSelectedTools(subdomainId) {
  const selected = [];
  if (document.getElementById('tool-dirsearch')?.checked) selected.push('dirsearch');
  if (document.getElementById('tool-wayback')?.checked) selected.push('wayback');
  if (document.getElementById('tool-params')?.checked) selected.push('params');

  if (!selected.length) {
    toast('Select at least one tool', 'error');
    return;
  }

  Modal.close();
  try {
    if (selected.includes('dirsearch')) await API.runDirsearch(subdomainId);
    if (selected.includes('wayback')) await API.runWayback(subdomainId);
    if (selected.includes('params')) await API.runParamsDiscovery(subdomainId);
    toast('Selected tools completed', 'success');
    if (_subdomainDetailId === subdomainId) openSubdomainDetail(subdomainId);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function httpxRow(label, value) {
  return `<tr><td style="color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px;white-space:nowrap;width:100px;">${label}</td><td style="font-size:12px;font-family:var(--mono);padding:6px 8px;word-break:break-all;">${value}</td></tr>`;
}

function httpxForm(sd) {
  const h = sd.httpx_data || {};
  return `
    <div class="form-row">
      <div class="form-group"><label>Status Code</label><input class="form-control" id="hx-status" value="${escHtml(String(h.status||''))}" placeholder="200" /></div>
      <div class="form-group"><label>IP</label><input class="form-control" id="hx-ip" value="${escHtml(h.ip||'')}" placeholder="1.2.3.4" /></div>
    </div>
    <div class="form-group"><label>Title</label><input class="form-control" id="hx-title" value="${escHtml(h.title||'')}" placeholder="Page title" /></div>
    <div class="form-group"><label>Tech Stack (comma-separated)</label><input class="form-control" id="hx-tech" value="${escHtml(Array.isArray(h.tech)?h.tech.join(', '):(h.tech||''))}" placeholder="Nginx, React, PHP" /></div>
    <div class="form-row">
      <div class="form-group"><label>Ports (comma-separated)</label><input class="form-control" id="hx-ports" value="${escHtml(Array.isArray(h.ports)?h.ports.join(', '):(h.ports||''))}" placeholder="80, 443, 8080" /></div>
      <div class="form-group"><label>TLS Issuer</label><input class="form-control" id="hx-tls-issuer" value="${escHtml(h.tls?.issuer||'')}" placeholder="Let's Encrypt" /></div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="saveHTTPX(${sd.id})">Save HTTPX Data</button>`;
}

async function saveHTTPX(sdId) {
  const status = Number.parseInt(document.getElementById('hx-status').value, 10) || null;
  const ip = document.getElementById('hx-ip').value.trim();
  const title = document.getElementById('hx-title').value.trim();
  const tech = document.getElementById('hx-tech').value.split(',').map(t=>t.trim()).filter(Boolean);
  const ports = document.getElementById('hx-ports').value.split(',').map((t) => Number.parseInt(t.trim(), 10)).filter((n) => !Number.isNaN(n));
  const tlsIssuer = document.getElementById('hx-tls-issuer').value.trim();
  const httpx_data = { status, ip, title, tech, ports, tls: tlsIssuer ? { issuer: tlsIssuer, valid: true } : null };
  try {
    const updated = await API.updateSubdomain(sdId, { httpx_data });
    toast('HTTPX data saved', 'success');
    renderHTTPXTab(updated);
    document.getElementById('detail-subtitle').innerHTML = updated.httpx_data?.status
      ? `${statusDot(updated.httpx_data.status)} <span style="font-family:var(--mono);font-size:11px;">${updated.httpx_data.status} ${updated.httpx_data?.title || ''}</span>`
      : 'No HTTPX data';
  } catch (e) { toast(e.message, 'error'); }
}

function renderDirsearchTab(sd) {
  const dirs = Array.isArray(sd.dirsearch_data) ? sd.dirsearch_data : [];
  const el = document.getElementById('dtab-dirsearch');
  const significant = dirs.filter(d => [200,201,204,301,302,403].includes(d.status));

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Directory Enumeration Results (${significant.length} significant)</div>
      ${significant.length === 0 ? `<p style="color:var(--text3);font-size:12px;">No results yet. Add below.</p>` : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Path</th><th>Status</th><th>Size</th><th></th></tr></thead>
          <tbody>
            ${significant.map((d,i) => `
              <tr>
                <td class="text-mono">${escHtml(d.path)}</td>
                <td>${statusDot(d.status)} <span class="text-mono" style="font-size:11px;">${d.status}</span></td>
                <td style="color:var(--text3);font-size:11px;font-family:var(--mono);">${d.size == null ? '—' : `${d.size}B`}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="removeDirsearchEntry(${sd.id},${i})">✕</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
    <div class="card">
      <div class="card-title">Add Entry</div>
      <div class="add-inline">
        <input id="dir-path" placeholder="/path/to/file" style="flex:2;" />
        <select id="dir-status"><option>200</option><option>301</option><option>302</option><option>403</option></select>
        <input id="dir-size" type="number" placeholder="Size (bytes)" style="flex:0.7;" />
        <button class="btn btn-primary btn-sm" onclick="addDirsearchEntry(${sd.id})">Add</button>
      </div>
    </div>`;
}

async function addDirsearchEntry(sdId) {
  const path = document.getElementById('dir-path').value.trim();
  const status = Number.parseInt(document.getElementById('dir-status').value, 10);
  const size = Number.parseInt(document.getElementById('dir-size').value, 10) || 0;
  if (!path) { toast('Path required', 'error'); return; }
  const sd = await API.getSubdomain(sdId);
  const current = Array.isArray(sd.dirsearch_data) ? sd.dirsearch_data : [];
  const updated = await API.updateSubdomain(sdId, { dirsearch_data: [...current, { path, status, size }] });
  toast('Entry added', 'success');
  renderDirsearchTab(updated);
}

async function removeDirsearchEntry(sdId, index) {
  const sd = await API.getSubdomain(sdId);
  const current = Array.isArray(sd.dirsearch_data) ? [...sd.dirsearch_data] : [];
  current.splice(index, 1);
  const updated = await API.updateSubdomain(sdId, { dirsearch_data: current });
  renderDirsearchTab(updated);
}

function renderWaybackTab(sd) {
  const urls = Array.isArray(sd.wayback_data) ? sd.wayback_data : [];
  const el = document.getElementById('dtab-wayback');
  const withParams = urls.filter(u => u.has_params);

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Wayback URLs (${urls.length} total · ${withParams.length} with params)</div>
      ${urls.length === 0 ? `<p style="color:var(--text3);font-size:12px;">No URLs yet. Add below.</p>` : `
      <div class="url-list" style="max-height:340px;overflow-y:auto;">
        ${urls.map((u,i) => `
          <div class="url-item ${u.has_params ? 'has-params' : ''}">
            ${u.has_params ? `<span class="url-item-param-badge">params</span>` : ''}
            <span style="flex:1;word-break:break-all;">${escHtml(u.url)}</span>
            <button class="btn btn-ghost btn-sm" onclick="removeWaybackEntry(${sd.id},${i})" style="flex-shrink:0;">✕</button>
          </div>`).join('')}
      </div>`}
    </div>
    <div class="card">
      <div class="card-title">Add URL</div>
      <div class="form-group">
        <input class="form-control" id="wb-url" placeholder="https://example.com/path?param=val" />
      </div>
      <button class="btn btn-primary btn-sm" onclick="addWaybackEntry(${sd.id})">Add URL</button>
      <button class="btn btn-ghost btn-sm" onclick="showWaybackBulkAdd(${sd.id})" style="margin-left:8px;">Bulk Paste</button>
    </div>`;
}

async function addWaybackEntry(sdId) {
  const url = document.getElementById('wb-url').value.trim();
  if (!url) { toast('URL required', 'error'); return; }
  const has_params = url.includes('?') && url.includes('=');
  const sd = await API.getSubdomain(sdId);
  const current = Array.isArray(sd.wayback_data) ? sd.wayback_data : [];
  if (current.some((u) => u.url === url)) { toast('Duplicate URL', 'error'); return; }
  const updated = await API.updateSubdomain(sdId, { wayback_data: [...current, { url, has_params }] });
  toast('URL added', 'success');
  renderWaybackTab(updated);
}

async function removeWaybackEntry(sdId, index) {
  const sd = await API.getSubdomain(sdId);
  const current = [...(sd.wayback_data || [])];
  current.splice(index, 1);
  const updated = await API.updateSubdomain(sdId, { wayback_data: current });
  renderWaybackTab(updated);
}

function showWaybackBulkAdd(sdId) {
  Modal.open({
    title: 'Bulk Add Wayback URLs',
    body: `
      <div class="form-group">
        <label>Paste URLs (one per line)</label>
        <textarea class="form-control" id="wb-bulk-text" rows="10" placeholder="https://example.com/path?q=1
https://example.com/other"></textarea>
      </div>`,
    footer: `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="bulkAddWayback(${sdId})">Import</button>`,
  });
}

async function bulkAddWayback(sdId) {
  const text = document.getElementById('wb-bulk-text').value.trim();
  const lines = [...new Set(text.split('\n').map(l => l.trim()).filter(l => l.startsWith('http')))];
  if (!lines.length) { toast('No valid URLs found', 'error'); return; }
  const sd = await API.getSubdomain(sdId);
  const current = Array.isArray(sd.wayback_data) ? sd.wayback_data : [];
  const existing = new Set(current.map(u => u.url));
  const newUrls = lines.filter(u => !existing.has(u)).map(url => ({ url, has_params: url.includes('?') && url.includes('=') }));
  const updated = await API.updateSubdomain(sdId, { wayback_data: [...current, ...newUrls] });
  Modal.close();
  toast(`${newUrls.length} URLs added`, 'success');
  renderWaybackTab(updated);
}

function renderParamsTab(sd) {
  const params = Array.isArray(sd.params_data) ? sd.params_data : [];
  const el = document.getElementById('dtab-params');

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title">Parameter Discovery (${params.length} endpoints)</div>
      ${params.length === 0 ? `<p style="color:var(--text3);font-size:12px;">No parameters discovered yet. Add below.</p>` : `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${params.map((p,i) => `
          <div class="card" style="padding:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div class="text-mono">${escHtml(p.endpoint)}</div>
              <button class="btn btn-ghost btn-sm" onclick="removeParam(${sd.id},${i})">✕</button>
            </div>
            <div style="margin-bottom:6px;color:var(--text3);font-size:11px;">Methods: ${escHtml(Array.isArray(p.method) ? p.method.join(', ') : 'GET')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${(p.params || []).map(param => `<span class="tag">${escHtml(param)}</span>`).join('')}
            </div>
          </div>`).join('')}
      </div>`}
    </div>
    <div class="card">
      <div class="card-title">Add Parameters</div>
      <div class="form-group"><label>Endpoint</label><input class="form-control" id="pr-endpoint" placeholder="/api/v1/users" /></div>
      <div class="form-group"><label>Methods (comma-separated)</label><input class="form-control" id="pr-methods" placeholder="GET, POST" /></div>
      <div class="form-group"><label>Parameters (comma-separated)</label><input class="form-control" id="pr-params" placeholder="id, page, limit, filter" /></div>
      <button class="btn btn-primary btn-sm" onclick="addParamGroup(${sd.id})">Add</button>
    </div>`;
}

async function addParamGroup(sdId) {
  const endpoint = document.getElementById('pr-endpoint').value.trim();
  const methods = document.getElementById('pr-methods').value.split(',').map(m => m.trim().toUpperCase()).filter(Boolean);
  const params = document.getElementById('pr-params').value.split(',').map(p => p.trim()).filter(Boolean);
  if (!endpoint || !params.length) { toast('Endpoint and params required', 'error'); return; }
  try {
    await API.addParamIntelligenceManual({ subdomain_id: sdId, endpoint, method: methods.length ? methods : ['GET'], params });
    const updated = await API.getSubdomain(sdId);
    toast('Parameters added', 'success');
    renderParamsTab(updated);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function removeParam(sdId, index) {
  const sd = await API.getSubdomain(sdId);
  const current = [...(sd.params_data || [])];
  current.splice(index, 1);
  const updated = await API.updateSubdomain(sdId, { params_data: current });
  renderParamsTab(updated);
}

// Detail panel tab switching
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-dtab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-dtab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`dtab-${tab.dataset.dtab}`).classList.add('active');
    });
  });

  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.remove('open');
    _subdomainDetailId = null;
  });
});
