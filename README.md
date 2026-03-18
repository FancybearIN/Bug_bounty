# ReconOps — Bug Bounty Recon Intelligence System

A local-first web application for advanced bug bounty hunters to manage reconnaissance, target mapping, and vulnerability tracking. Runs fully offline at `http://localhost:9000`.

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
cd backend
npm install

# 2. Seed with sample data (optional but recommended)
node db/seed.js

# 3. Start the server
node server.js
```

Then open **http://localhost:9000** in your browser.

---

## 📁 Project Structure

```
Bug_bounty/
├── backend/
│   ├── server.js          # Express entry point (port 9000)
│   ├── package.json
│   ├── db/
│   │   ├── schema.sql     # SQLite schema
│   │   ├── init.js        # DB initializer
│   │   ├── seed.js        # Sample data seeder
│   │   └── recon.db       # Created on first run (auto-generated)
│   └── routes/
│       ├── workspaces.js
│       ├── scope.js
│       ├── subdomains.js
│       ├── modules.js
│       ├── bugs.js
│       └── checklist.js
└── frontend/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── api.js           # Fetch API wrapper
        ├── utils.js         # Helpers
        ├── modal.js         # Modal manager
        ├── app.js           # SPA router
        └── pages/
            ├── workspaces.js
            ├── scope.js
            ├── subdomains.js
            ├── modules.js
            ├── bugs.js
            └── checklist.js
```

---

## 🧠 Core Concepts

### Workspaces
Each workspace = one bug bounty program. All data (scope, subdomains, bugs, checklist) is scoped per workspace. Use the dropdown in the sidebar to switch between programs.

### Navigation (Keyboard Shortcuts)
| Key | Page |
|-----|------|
| `1` | Workspaces |
| `2` | Scope |
| `3` | Subdomains |
| `4` | Modules |
| `5` | Bugs |
| `6` | Checklist |

---

## 🌐 Features

### Scope Management
- Upload **HackerOne JSON**, **Bugcrowd JSON**, or plain **TXT** scope file
- Automatically classifies entries: `domain`, `wildcard`, `api`, `mobile`
- Manual entry with type selection

### Subdomain Intelligence
- Upload TXT list or add manually
- Grouped by root domain in a collapsible tree/grid view
- Click any subdomain → **detail panel** with 4 tabs:
  - **HTTPX**: status code, title, tech stack, IP, ports, TLS
  - **Dirsearch**: meaningful results (200/301/302/403) with path + size
  - **Wayback**: deduplicated URLs, highlighted param endpoints
  - **Params**: grouped parameters per endpoint (Arjun/ParamSpider output)

### Module & Endpoint Mapping
- Hierarchical: **Module → Submodule → Endpoints**
- Per-endpoint tested checkbox with progress bar per module
- Quick-add inline (no modal needed for simple entries)

### Bug Tracking
- Severity: Critical / High / Medium / Low
- Status: Not Tested → Testing → Found → Reported → Duplicate
- Inline status dropdown and reported toggle in the table
- Full-text search + severity + status filters

### Testing Checklist
- 70+ pre-loaded OWASP-based checks (no Informational items)
- Categories: Auth, IDOR, Injection, XSS, SSRF, File Upload, Business Logic, API, Crypto, CSRF, DNS, Deserialization, Path Traversal, RCE
- Per-category progress indicator
- Filter by severity, status (done/pending), or keyword
- Add custom items per workspace

---

## 📦 API Reference

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST/DELETE | `/api/workspaces` | Workspace CRUD |
| GET | `/api/scope?workspace_id=X` | Get scope entries |
| POST | `/api/scope/upload` | Upload scope file |
| GET/POST | `/api/subdomains` | List/add subdomains |
| POST | `/api/subdomains/upload` | Upload TXT list |
| PATCH | `/api/subdomains/:id` | Update HTTPX/Dirsearch/Wayback/Params |
| GET/POST | `/api/modules` | Module tree |
| POST | `/api/modules/:id/endpoints` | Add endpoint |
| GET/POST | `/api/bugs` | Bug CRUD |
| GET/PATCH | `/api/checklist` | Checklist |
| GET | `/api/export/:workspace_id` | Export workspace JSON |
| POST | `/api/import` | Import workspace JSON |

---

## 🗄️ Database

SQLite (single file: `backend/db/recon.db`). Automatically created on first run.

To reset all data:
```bash
rm backend/db/recon.db
node backend/server.js  # re-creates schema
node backend/db/seed.js  # optional: re-seed
```

---

## 🔌 Optional: MariaDB

The current setup uses SQLite. To migrate to MariaDB:
1. Replace `better-sqlite3` with `mysql2`
2. Adapt `db/init.js` with a connection pool
3. Adjust SQL syntax as needed (minor changes)

---

## 📤 Export / Import

- **Export**: Click "Export" on any workspace card → downloads `WorkspaceName-export.json`
- **Import**: Click "Import" on the Workspaces page → select a JSON export file

---

## 🛠️ Requirements

- **Node.js** 18+ (LTS recommended)
- **npm** 8+
- No internet connection required after installation

---

## 🧪 Sample Data

After running `node db/seed.js`, the "Example Corp" workspace is pre-loaded with:
- Scope: `*.example.com`, `api.example.com`, `com.example.app`
- Subdomains: `api.example.com`, `admin.example.com`, `dev.example.com` (with HTTPX data)
- Modules: Authentication (Login, Password Reset), User Management (Profile)
- Endpoints: 7 endpoints with parameters
- Bugs: 3 sample vulnerabilities (IDOR, SQLi, phpinfo exposure)
- Checklist: 70+ OWASP-based items

---

*ReconOps — built for real bug bounty workflows.*
