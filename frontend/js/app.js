// Main App Router
const App = (() => {
  const pages = {
    workspaces: { title: 'Workspaces', subtitle: 'manage bug bounty programs', render: renderWorkspaces },
    scope:      { title: 'Scope',      subtitle: 'in-scope targets',            render: renderScope },
    subdomains: { title: 'Subdomains', subtitle: 'subdomain tree view',         render: renderSubdomains },
    httpx:      { title: 'HTTPX',      subtitle: 'HTTP response intelligence',  render: renderHttpx },
    tools:      { title: 'Tools',      subtitle: 'tool detection and settings',  render: renderTools },
    modules:    { title: 'Modules',    subtitle: 'endpoint mapping',             render: renderModules },
    bugs:       { title: 'Bugs',       subtitle: 'vulnerability tracking',       render: renderBugs },
    checklist:  { title: 'Checklist',  subtitle: 'OWASP test coverage',          render: renderChecklist },
  };

  let currentPage = '';

  function navigate(page) {
    if (!pages[page]) page = 'workspaces';
    currentPage = page;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Update topbar
    const p = pages[page];
    document.getElementById('topbar-title').textContent = p.title;
    document.getElementById('topbar-subtitle').textContent = p.subtitle;

    // Render page
    p.render();

    // Store in hash
    location.hash = page;
  }

  function init() {
    // Nav click handlers
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.page));
    });

    // Workspace selector change
    document.getElementById('ws-select').addEventListener('change', async (e) => {
      const id = e.target.value;
      if (!id) { setActiveWorkspace('', ''); return; }
      const name = e.target.options[e.target.selectedIndex].textContent;
      setActiveWorkspace(id, name);
      toast(`Switched to "${name}"`, 'success');
      // Re-render current page
      if (currentPage && currentPage !== 'workspaces') navigate(currentPage);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

      const shortcuts = { '1': 'workspaces', '2': 'scope', '3': 'subdomains', '4': 'httpx', '5': 'tools', '6': 'modules', '7': 'bugs', '8': 'checklist' };
      if (shortcuts[e.key]) { navigate(shortcuts[e.key]); }
    });

    // Load workspaces into selector
    refreshWorkspaceSelector().then(() => {
      // Navigate to page from hash, or default to workspaces
      const hash = location.hash.replace('#', '') || 'workspaces';
      navigate(hash in pages ? hash : 'workspaces');
    });
  }

  return { navigate, init };
})();

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
