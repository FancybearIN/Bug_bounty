// Centralized API client
const API = (() => {
  const BASE = '/api';

  async function req(method, path, body, isFormData = false) {
    const opts = { method };
    if (body) {
      if (isFormData) {
        opts.body = body;
      } else {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(BASE + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    // Workspaces
    getWorkspaces: () => req('GET', '/workspaces'),
    createWorkspace: (b) => req('POST', '/workspaces', b),
    deleteWorkspace: (id) => req('DELETE', `/workspaces/${id}`),
    updateWorkspace: (id, b) => req('PATCH', `/workspaces/${id}`, b),

    // Scope
    getScope: (wsId, onlyActive = false) => req('GET', `/scope?workspace_id=${wsId}${onlyActive ? '&only_active=true' : ''}`),
    uploadScope: (file, workspaceName) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('workspace_name', workspaceName);
      return req('POST', '/scope/upload', fd, true);
    },
    addScope: (b) => req('POST', '/scope', b),
    updateScopeActive: (id, is_active) => req('PATCH', `/scope/${id}/active`, { is_active }),
    addScopeToRecon: (id) => req('POST', `/scope/${id}/add-to-recon`, {}),
    deleteScope: (id) => req('DELETE', `/scope/${id}`),

    // Subdomains
    getSubdomains: (wsId) => req('GET', `/subdomains?workspace_id=${wsId}`),
    getSubdomainTree: (wsId) => req('GET', `/subdomains/tree?workspace_id=${wsId}`),
    getFilteredSubdomains: (targetId, filters = {}) => {
      const p = new URLSearchParams({ target_id: targetId });
      if (filters.status) p.set('status', filters.status);
      if (filters.tech) p.set('tech', filters.tech);
      if (filters.cdn !== undefined && filters.cdn !== '') p.set('cdn', filters.cdn);
      if (filters.keyword) p.set('keyword', filters.keyword);
      if (filters.sort) p.set('sort', filters.sort);
      return req('GET', `/subdomains/filtered?${p.toString()}`);
    },
    getSubdomain: (id) => req('GET', `/subdomains/${id}`),
    addSubdomain: (b) => req('POST', '/subdomains', b),
    uploadSubdomains: (wsId, file) => {
      const fd = new FormData();
      fd.append('workspace_id', wsId);
      fd.append('file', file);
      return req('POST', '/subdomains/upload', fd, true);
    },
    updateSubdomain: (id, b) => req('PATCH', `/subdomains/${id}`, b),
    deleteSubdomain: (id) => req('DELETE', `/subdomains/${id}`),

    // Modules
    getModules: (wsId, filters = {}) => {
      const p = new URLSearchParams({ workspace_id: wsId });
      if (filters.method) p.set('method', filters.method);
      if (filters.param) p.set('param', filters.param);
      if (filters.module_id) p.set('module_id', filters.module_id);
      if (filters.subdomain_id) p.set('subdomain_id', filters.subdomain_id);
      return req('GET', `/modules?${p.toString()}`);
    },
    createModule: (b) => req('POST', '/modules', b),
    updateModule: (id, b) => req('PATCH', `/modules/${id}`, b),
    deleteModule: (id) => req('DELETE', `/modules/${id}`),
    addEndpoint: (modId, b) => req('POST', `/modules/${modId}/endpoints`, b),
    updateEndpoint: (modId, epId, b) => req('PATCH', `/modules/${modId}/endpoints/${epId}`, b),
    deleteEndpoint: (modId, epId) => req('DELETE', `/modules/${modId}/endpoints/${epId}`),

    // Bugs
    getBugs: (wsId, filters = {}) => {
      const p = new URLSearchParams({ workspace_id: wsId, ...filters });
      return req('GET', `/bugs?${p}`);
    },
    createBug: (b) => req('POST', '/bugs', b),
    updateBug: (id, b) => req('PATCH', `/bugs/${id}`, b),
    deleteBug: (id) => req('DELETE', `/bugs/${id}`),

    // Checklist
    getChecklist: (wsId) => req('GET', `/checklist?workspace_id=${wsId}`),
    toggleChecklist: (id, done) => req('PATCH', `/checklist/${id}`, { done }),
    addChecklistItem: (b) => req('POST', '/checklist', b),
    resetChecklist: (wsId) => req('POST', '/checklist/reset', { workspace_id: wsId }),
    deleteChecklistItem: (id) => req('DELETE', `/checklist/${id}`),

    // Export/Import
    exportWorkspace: (wsId) => { window.open(`/api/export/${wsId}`, '_blank'); },
    importWorkspace: (data) => req('POST', '/import', data),

    // Targets / Target context
    getTargets: (wsId, type = '') => {
      const p = new URLSearchParams({ workspace_id: wsId });
      if (type) p.set('type', type);
      return req('GET', `/targets?${p.toString()}`);
    },
    getTargetChecklist: (targetId) => req('GET', `/target-checklist?target_id=${targetId}`),
    getFindings: (targetId) => req('GET', `/findings?target_id=${targetId}`),
    getJobs: (targetId) => req('GET', `/jobs?target_id=${targetId}`),
    getSubdomainJobs: (subdomainId) => req('GET', `/jobs?subdomain_id=${subdomainId}`),
    getJobResults: (jobId) => req('GET', `/jobs/${jobId}/results`),
    getCoverage: (targetId) => req('GET', `/coverage?target_id=${targetId}`),

    // Recon ingestion
    importHttpx: (targetId, content) => req('POST', '/recon/import/httpx', { target_id: targetId, content }),
    importDirsearch: (targetId, content) => req('POST', '/recon/import/dirsearch', { target_id: targetId, content }),
    importWayback: (targetId, content) => req('POST', '/recon/import/wayback', { target_id: targetId, content }),
    importParams: (targetId, content) => req('POST', '/recon/import/params', { target_id: targetId, content }),
    getParamIntelligence: (targetId) => req('GET', `/recon/intelligence/params?target_id=${targetId}`),

    // Recon pipeline
    runSubdomainDiscovery: (targetId, tools) => req('POST', '/recon/subdomain-discovery', { target_id: targetId, tools }),
    runHttpxPipeline: (targetId) => req('POST', '/recon/httpx', { target_id: targetId }),
    promoteAliveDomains: (targetId) => req('POST', '/recon/promote-alive', { target_id: targetId }),
    runDirsearch: (subdomainId) => req('POST', '/recon/dirsearch', { subdomain_id: subdomainId }),
    runWayback: (subdomainId) => req('POST', '/recon/wayback', { subdomain_id: subdomainId }),
    runParamsDiscovery: (subdomainId) => req('POST', '/recon/params', { subdomain_id: subdomainId }),
    runAllSubdomainTools: (subdomainId, tools) => req('POST', '/recon/run-all-tools', { subdomain_id: subdomainId, tools }),
    runFfuf: (subdomainId) => req('POST', '/recon/ffuf', { subdomain_id: subdomainId }),
    runBulkScan: (targetId, tools) => req('POST', '/recon/bulk-scan', { target_id: targetId, tools }),
    addParamIntelligenceManual: (b) => req('POST', '/recon/params/manual', b),
    getReconFlow: (wsId) => req('GET', `/recon/flow?workspace_id=${wsId}`),
    getAutoReconMode: (wsId) => req('GET', `/recon/auto-mode?workspace_id=${wsId}`),
    setAutoReconMode: (wsId, enabled) => req('PATCH', '/recon/auto-mode', { workspace_id: wsId, enabled }),
    getReconToolSettings: (wsId) => req('GET', `/recon/tool-settings?workspace_id=${wsId}`),
    setReconToolSettings: (wsId, tool, enabled, config) => req('PATCH', '/recon/tool-settings', { workspace_id: wsId, tool, enabled, config }),

    // Tool detection/settings
    getToolsStatus: (wsId = '') => req('GET', wsId ? `/tools/status?workspace_id=${wsId}` : '/tools/status'),
    getToolSettings: (wsId) => req('GET', `/tools/settings?workspace_id=${wsId}`),
    setToolSettings: (wsId, tool, enabled, config) => req('PATCH', '/tools/settings', { workspace_id: wsId, tool, enabled, config }),
  };
})();
