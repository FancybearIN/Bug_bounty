const { initDb, getDb } = require('./init');

const CHECKLIST_DEFAULTS = [
  // Authentication
  { category: 'Authentication', title: 'Test for default credentials', severity: 'High' },
  { category: 'Authentication', title: 'Brute force login endpoint (no rate limit)', severity: 'High' },
  { category: 'Authentication', title: 'Password reset token entropy / reuse', severity: 'High' },
  { category: 'Authentication', title: 'JWT algorithm confusion (none/RS256→HS256)', severity: 'Critical' },
  { category: 'Authentication', title: 'Session fixation after login', severity: 'Medium' },
  { category: 'Authentication', title: 'OAuth token leakage in referrer/URL', severity: 'High' },
  { category: 'Authentication', title: 'MFA bypass via response manipulation', severity: 'Critical' },
  { category: 'Authentication', title: 'Account enumeration via error messages', severity: 'Medium' },

  // Authorization / IDOR
  { category: 'IDOR / Authorization', title: 'IDOR on user-specific resource IDs', severity: 'High' },
  { category: 'IDOR / Authorization', title: 'Horizontal privilege escalation (access other user data)', severity: 'High' },
  { category: 'IDOR / Authorization', title: 'Vertical privilege escalation (user → admin)', severity: 'Critical' },
  { category: 'IDOR / Authorization', title: 'Broken function-level authorization on admin APIs', severity: 'Critical' },
  { category: 'IDOR / Authorization', title: 'Mass assignment / parameter pollution', severity: 'High' },
  { category: 'IDOR / Authorization', title: 'IDOR via indirect object references (hashed IDs)', severity: 'Medium' },

  // Injection
  { category: 'Injection', title: 'SQL injection (GET/POST parameters)', severity: 'Critical' },
  { category: 'Injection', title: 'Blind SQL injection (time-based)', severity: 'Critical' },
  { category: 'Injection', title: 'NoSQL injection (MongoDB operators)', severity: 'High' },
  { category: 'Injection', title: 'Command injection via system calls', severity: 'Critical' },
  { category: 'Injection', title: 'LDAP injection', severity: 'High' },
  { category: 'Injection', title: 'XML / XXE injection', severity: 'High' },
  { category: 'Injection', title: 'SSTI (Server-Side Template Injection)', severity: 'Critical' },
  { category: 'Injection', title: 'CSV/formula injection in exports', severity: 'Medium' },

  // XSS
  { category: 'XSS', title: 'Reflected XSS in search/query params', severity: 'Medium' },
  { category: 'XSS', title: 'Stored XSS in user-supplied content', severity: 'High' },
  { category: 'XSS', title: 'DOM-based XSS via URL fragments', severity: 'Medium' },
  { category: 'XSS', title: 'XSS via HTTP headers (X-Forwarded-For, Referer)', severity: 'Medium' },
  { category: 'XSS', title: 'XSS in file upload (SVG, HTML, XML)', severity: 'High' },
  { category: 'XSS', title: 'XSS via JSONP callback parameter', severity: 'High' },

  // SSRF
  { category: 'SSRF', title: 'SSRF via URL parameter (webhook, avatar, import)', severity: 'Critical' },
  { category: 'SSRF', title: 'Blind SSRF to internal metadata endpoint (AWS/GCP)', severity: 'Critical' },
  { category: 'SSRF', title: 'SSRF bypass via DNS rebinding', severity: 'High' },
  { category: 'SSRF', title: 'SSRF via redirect chain', severity: 'High' },
  { category: 'SSRF', title: 'SSRF to internal network scan', severity: 'High' },

  // File Upload
  { category: 'File Upload', title: 'Unrestricted file upload (webshell)', severity: 'Critical' },
  { category: 'File Upload', title: 'MIME type bypass for executable upload', severity: 'High' },
  { category: 'File Upload', title: 'Path traversal in file name', severity: 'High' },
  { category: 'File Upload', title: 'Stored XSS via malicious file content', severity: 'Medium' },

  // Business Logic
  { category: 'Business Logic', title: 'Negative price / quantity manipulation', severity: 'High' },
  { category: 'Business Logic', title: 'Race condition on coupon/credit redemption', severity: 'High' },
  { category: 'Business Logic', title: 'Bypassing payment step in checkout flow', severity: 'Critical' },
  { category: 'Business Logic', title: 'Account takeover via email change without confirmation', severity: 'Critical' },
  { category: 'Business Logic', title: 'Insecure state transition (skip workflow steps)', severity: 'High' },

  // API
  { category: 'API Security', title: 'Undocumented / shadow API endpoints', severity: 'High' },
  { category: 'API Security', title: 'API versioning — older version lacks security controls', severity: 'High' },
  { category: 'API Security', title: 'GraphQL introspection enabled + batch query abuse', severity: 'Medium' },
  { category: 'API Security', title: 'GraphQL IDOR / BAC on mutations', severity: 'High' },
  { category: 'API Security', title: 'Excessive data exposure in API response', severity: 'Medium' },
  { category: 'API Security', title: 'Lack of object/field-level authorization in REST', severity: 'High' },

  // Cryptography
  { category: 'Cryptography', title: 'Weak token signing (MD5 / SHA1 HMAC)', severity: 'High' },
  { category: 'Cryptography', title: 'Hardcoded secrets in JS/source', severity: 'Critical' },
  { category: 'Cryptography', title: 'Insecure random token generation (predictable)', severity: 'High' },

  // Headers / CSRF
  { category: 'CSRF / Headers', title: 'CSRF on state-changing requests (no token)', severity: 'High' },
  { category: 'CSRF / Headers', title: 'CSRF token bypass (referer check only)', severity: 'Medium' },
  { category: 'CSRF / Headers', title: 'Clickjacking via missing X-Frame-Options', severity: 'Low' },
  { category: 'CSRF / Headers', title: 'CORS misconfiguration (null origin / wildcard + creds)', severity: 'High' },

  // Subdomain / DNS
  { category: 'Subdomain / DNS', title: 'Subdomain takeover (dangling CNAME)', severity: 'High' },
  { category: 'Subdomain / DNS', title: 'Open redirect on subdomain', severity: 'Medium' },
  { category: 'Subdomain / DNS', title: 'Wildcard DNS abuse', severity: 'Medium' },

  // Deserialization
  { category: 'Deserialization', title: 'Insecure Java deserialization (RCE)', severity: 'Critical' },
  { category: 'Deserialization', title: 'PHP object injection', severity: 'Critical' },
  { category: 'Deserialization', title: 'Python pickle deserialization', severity: 'Critical' },

  // Path Traversal
  { category: 'Path Traversal', title: 'Local file read via path traversal', severity: 'High' },
  { category: 'Path Traversal', title: 'Path traversal in ZIP/archive extraction', severity: 'High' },
  { category: 'Path Traversal', title: 'Symlink attacks on file operations', severity: 'Medium' },

  // RCE / SSTI
  { category: 'RCE', title: 'RCE via eval of user input', severity: 'Critical' },
  { category: 'RCE', title: 'RCE via image processing library (ImageMagick)', severity: 'Critical' },
  { category: 'RCE', title: 'RCE via log injection + log viewer', severity: 'High' },
];

function seedWorkspace(db, workspaceName, description) {
  const existing = db.prepare('SELECT id FROM workspaces WHERE name = ?').get(workspaceName);
  if (existing) {
    console.log(`[SEED] Workspace "${workspaceName}" already exists (id=${existing.id}), skipping.`);
    return existing.id;
  }

  const wsResult = db.prepare('INSERT INTO workspaces (name, description) VALUES (?, ?)').run(workspaceName, description);
  const wsId = wsResult.lastInsertRowid;
  console.log(`[SEED] Created workspace "${workspaceName}" (id=${wsId})`);
  return wsId;
}

function seedScopeEntries(db, wsId) {
  const entries = [
    { type: 'wildcard', value: '*.example.com', notes: 'All subdomains' },
    { type: 'domain', value: 'example.com', notes: 'Root domain' },
    { type: 'api', value: 'api.example.com', notes: 'REST API endpoint' },
    { type: 'mobile', value: 'com.example.app', notes: 'Android App' },
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO scope_entries (workspace_id, type, value, notes) VALUES (?,?,?,?)');
  for (const e of entries) stmt.run(wsId, e.type, e.value, e.notes);
  console.log('[SEED] Scope entries inserted');
}

function seedSubdomains(db, wsId) {
  const subdomains = [
    {
      value: 'api.example.com',
      httpx_data: JSON.stringify({ status: 200, title: 'Example API', tech: ['Node.js', 'Nginx'], ip: '93.184.216.34', ports: [80, 443], tls: { issuer: "Let's Encrypt", valid: true } }),
      dirsearch_data: JSON.stringify([
        { path: '/api/v1/users', status: 200, size: 1240 },
        { path: '/api/v1/admin', status: 403, size: 89 },
        { path: '/api/docs', status: 301, size: 0 },
      ]),
      wayback_data: JSON.stringify([
        { url: 'https://api.example.com/api/v1/users?id=1', has_params: true },
        { url: 'https://api.example.com/api/v1/products', has_params: false },
        { url: 'https://api.example.com/api/v1/auth/login?redirect=/', has_params: true },
      ]),
      params_data: JSON.stringify([
        { endpoint: '/api/v1/users', params: ['id', 'page', 'limit'] },
        { endpoint: '/api/v1/search', params: ['q', 'type', 'filter'] },
      ]),
    },
    {
      value: 'admin.example.com',
      httpx_data: JSON.stringify({ status: 200, title: 'Admin Panel', tech: ['React', 'Apache'], ip: '93.184.216.35', ports: [443], tls: { issuer: 'DigiCert', valid: true } }),
      dirsearch_data: JSON.stringify([
        { path: '/admin/login', status: 200, size: 4500 },
        { path: '/admin/users', status: 302, size: 0 },
      ]),
      wayback_data: JSON.stringify([]),
      params_data: JSON.stringify([]),
    },
    {
      value: 'dev.example.com',
      httpx_data: JSON.stringify({ status: 200, title: 'Dev Environment', tech: ['PHP', 'Apache', 'MySQL'], ip: '10.0.0.5', ports: [80, 8080, 3306], tls: null }),
      dirsearch_data: JSON.stringify([
        { path: '/phpinfo.php', status: 200, size: 78000 },
        { path: '/.git/', status: 403, size: 50 },
        { path: '/config.php.bak', status: 200, size: 340 },
      ]),
      wayback_data: JSON.stringify([]),
      params_data: JSON.stringify([]),
    },
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO subdomains (workspace_id, value, httpx_data, dirsearch_data, wayback_data, params_data)
    VALUES (?,?,?,?,?,?)
  `);
  for (const s of subdomains) stmt.run(wsId, s.value, s.httpx_data, s.dirsearch_data, s.wayback_data, s.params_data);
  console.log('[SEED] Subdomains inserted');
}

function seedModules(db, wsId) {
  const authMod = db.prepare('INSERT INTO modules (workspace_id, name, parent_id) VALUES (?,?,?)').run(wsId, 'Authentication', null);
  const loginSub = db.prepare('INSERT INTO modules (workspace_id, name, parent_id) VALUES (?,?,?)').run(wsId, 'Login', authMod.lastInsertRowid);
  const passSub = db.prepare('INSERT INTO modules (workspace_id, name, parent_id) VALUES (?,?,?)').run(wsId, 'Password Reset', authMod.lastInsertRowid);

  const userMod = db.prepare('INSERT INTO modules (workspace_id, name, parent_id) VALUES (?,?,?)').run(wsId, 'User Management', null);
  const profileSub = db.prepare('INSERT INTO modules (workspace_id, name, parent_id) VALUES (?,?,?)').run(wsId, 'Profile', userMod.lastInsertRowid);

  const epStmt = db.prepare('INSERT INTO endpoints (module_id, method, path, parameters, notes) VALUES (?,?,?,?,?)');
  epStmt.run(loginSub.lastInsertRowid, 'GET', '/login', '[]', 'Login page');
  epStmt.run(loginSub.lastInsertRowid, 'POST', '/api/auth/login', JSON.stringify(['username','password','remember_me']), 'Check for SQLi, brute force');
  epStmt.run(loginSub.lastInsertRowid, 'DELETE', '/api/auth/session', '[]', 'Logout endpoint');
  epStmt.run(passSub.lastInsertRowid, 'POST', '/api/auth/forgot-password', JSON.stringify(['email']), 'Check token entropy');
  epStmt.run(passSub.lastInsertRowid, 'POST', '/api/auth/reset-password', JSON.stringify(['token','password']), 'Check token reuse');
  epStmt.run(profileSub.lastInsertRowid, 'GET', '/api/users/:id', JSON.stringify(['id']), 'IDOR check');
  epStmt.run(profileSub.lastInsertRowid, 'PUT', '/api/users/:id', JSON.stringify(['id','email','role']), 'Mass assignment check');

  console.log('[SEED] Modules & endpoints inserted');
  return authMod.lastInsertRowid;
}

function seedBugs(db, wsId, moduleId) {
  const bugs = [
    {
      title: 'IDOR on /api/users/:id — Access Any User Profile',
      severity: 'High',
      target: 'api.example.com',
      module_id: moduleId,
      description: 'Changing the user ID in the URL allows accessing other users\' profile data without authorization.',
      steps: '1. Login as user A\n2. GET /api/users/2\n3. Observe user B\'s data returned',
      impact: 'Unauthorized access to PII of all users',
      status: 'Found',
      reported: 1,
    },
    {
      title: 'SQL Injection in POST /api/auth/login — username field',
      severity: 'Critical',
      target: 'api.example.com',
      module_id: moduleId,
      description: 'The username field is not sanitized, allowing time-based blind SQL injection.',
      steps: '1. POST /api/auth/login\n2. username=admin\' AND SLEEP(5)--\n3. Observe 5 second delay',
      impact: 'Full database dump, potential RCE via INTO OUTFILE',
      status: 'Reported',
      reported: 1,
    },
    {
      title: 'phpinfo.php exposed on dev.example.com',
      severity: 'Medium',
      target: 'dev.example.com',
      module_id: null,
      description: 'phpinfo() page is publicly accessible revealing server config, paths, and env variables.',
      steps: '1. GET https://dev.example.com/phpinfo.php',
      impact: 'Information disclosure — can aid further attacks',
      status: 'Testing',
      reported: 0,
    },
  ];
  const stmt = db.prepare(`
    INSERT INTO bugs (workspace_id, title, severity, target, module_id, description, steps, impact, status, reported)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  for (const b of bugs) stmt.run(wsId, b.title, b.severity, b.target, b.module_id, b.description, b.steps, b.impact, b.status, b.reported);
  console.log('[SEED] Bugs inserted');
}

function seedChecklist(db, wsId) {
  const stmt = db.prepare(`
    INSERT INTO checklist_items (workspace_id, category, title, severity, description, done)
    VALUES (?,?,?,?,?,0)
  `);
  for (const item of CHECKLIST_DEFAULTS) {
    stmt.run(wsId, item.category, item.title, item.severity, item.description || '');
  }
  console.log('[SEED] Checklist items inserted');
}

// Main
initDb();
const db = getDb();

const wsId = seedWorkspace(db, 'Example Corp', 'Demo bug bounty program on example.com');
seedScopeEntries(db, wsId);
seedSubdomains(db, wsId);
const modId = seedModules(db, wsId);
seedBugs(db, wsId, modId);
seedChecklist(db, wsId);

db.close();
console.log('\n[SEED] Done! Open http://localhost:9000 and select "Example Corp" workspace.');

module.exports = { CHECKLIST_DEFAULTS };
