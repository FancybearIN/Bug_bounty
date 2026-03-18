#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
#  ReconOps — Bug Bounty Intelligence System
#  Single-file startup script
# ──────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/backend"
DB="$BACKEND/db/recon.db"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ReconOps — Bug Bounty Intelligence System   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Strip Python venv from PATH ────────────────────
#    better-sqlite3 compiles a native addon via node-gyp.
#    If a Python venv is active, node-gyp uses its Python
#    which is missing the 'gyp' module → build fails.
if [ -n "$VIRTUAL_ENV" ]; then
  echo "[*] Python venv detected — removing from PATH for npm build..."
  export PATH="${PATH//$VIRTUAL_ENV\/bin:/}"
  unset VIRTUAL_ENV PYTHON PYTHONHOME PYTHONPATH
fi

# ── 2. Ensure build tools are present ─────────────────
if ! command -v gcc &>/dev/null; then
  echo "[*] gcc not found — installing build tools (requires sudo)..."
  sudo apt-get install -y --no-install-recommends \
    build-essential python3-gyp python3-dev && \
    echo "[✓] Build tools installed" || \
    echo "[!] Auto-install failed. Run manually: sudo apt-get install build-essential python3-gyp python3-dev"
fi

# ── 3. Install Node.js dependencies ───────────────────
if [ ! -d "$BACKEND/node_modules" ]; then
  echo "[*] Installing dependencies..."
  cd "$BACKEND"
  PYTHON=$(command -v python3) npm install
  echo "[✓] Dependencies installed"
else
  echo "[✓] Dependencies already installed"
fi

# ── 4. Seed sample data on first run ──────────────────
if [ ! -f "$DB" ]; then
  echo "[*] First run — seeding sample data..."
  cd "$BACKEND" && node db/seed.js
  echo "[✓] Sample data loaded (workspace: 'Example Corp')"
else
  echo "[✓] Database found"
fi

# ── 5. Start server ────────────────────────────────────
echo ""
echo "[*] Starting server at http://localhost:9000"
echo "    Press Ctrl+C to stop"
echo ""
cd "$BACKEND" && node server.js
