#!/usr/bin/env bash
# One-shot install for Sman-Backend on the EC2 host, run alongside Django.
# Does everything up through Phase 2 of docs/DEPLOY_EC2.md — clone/pull,
# install deps, install+start the systemd service, then checks health.
# Does NOT touch nginx or expose anything publicly (see docs/DEPLOY_EC2.md
# Phase 3+ for that, deliberately manual and separate).
#
# Usage: run this ON THE EC2 BOX over SSH, from wherever you want
# sman-backend cloned as a sibling of the Django project, e.g.:
#   cd ~ && curl -fsSL <raw-url-to-this-file> | bash -s -- <repo-url>
# or, having already cloned the repo once:
#   cd ~/sman-backend && ./deploy/setup.sh

set -euo pipefail

REPO_URL="${1:-}"
PROJECT_DIR="$HOME/sman-backend"
PORT="${PORT:-5002}"

echo "== Sman-Backend EC2 setup =="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node 20+ first, then re-run." >&2
  exit 1
fi
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node $NODE_MAJOR found, need >=20." >&2
  exit 1
fi
echo "node $(node -v) OK"

if [ -d "$PROJECT_DIR/.git" ]; then
  echo "-- $PROJECT_DIR already exists, pulling latest --"
  cd "$PROJECT_DIR"
  git pull origin main
else
  if [ -z "$REPO_URL" ]; then
    echo "ERROR: $PROJECT_DIR doesn't exist yet — pass the repo URL as the first argument." >&2
    exit 1
  fi
  echo "-- cloning $REPO_URL into $PROJECT_DIR --"
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo ""
  echo "!! No .env found at $PROJECT_DIR/.env !!"
  echo "Create it now (see docs/DEPLOY_EC2.md Phase 1 for the exact keys needed),"
  echo "then re-run this script — it will pick up from here."
  exit 1
fi
echo ".env present"

echo "-- installing dependencies --"
npm ci --omit=dev

echo "-- installing systemd service --"
sudo cp deploy/sman-backend.service /etc/systemd/system/sman-backend.service
sudo sed -i "s|__DEPLOY_USER__|$(whoami)|g; s|__PROJECT_DIR__|$PROJECT_DIR|g" /etc/systemd/system/sman-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now sman-backend

echo "-- waiting for it to come up --"
sleep 3
sudo systemctl status sman-backend --no-pager | head -5

echo ""
echo "-- health check --"
if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
  echo ""
  echo ""
  echo "✅ Sman-Backend is running and healthy on 127.0.0.1:${PORT}."
  echo "Next: docs/DEPLOY_EC2.md Phase 3 (expose on a side subdomain to test for real)."
else
  echo ""
  echo "❌ Health check failed. Check: journalctl -u sman-backend -n 50 --no-pager"
  exit 1
fi
