#!/bin/bash
#
# Point every front end at production or at the local backend, in one go.
#
#   bash scripts/point-apps.sh prod     → https://sman-backend.onrender.com
#   bash scripts/point-apps.sh local    → http://localhost:5002 (LAN IP for Expo)
#   bash scripts/point-apps.sh status   → show where each app currently points
#
# There are five apps across four repos and three different variable names, so
# doing this by hand reliably missed one — which is how a "local" session ended
# up reading production data. Every write is backed up next to the file first.
#
# The Expo apps get the Mac's LAN IP rather than localhost: a phone resolves
# localhost to itself and would never reach this machine.
set -euo pipefail

MODE="${1:-status}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROD_URL="${PROD_BACKEND_URL:-https://sman-backend.onrender.com}"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"

# file | variable | local value | production value
TARGETS=(
  "$ROOT/soroman-web/.env|VITE_SERVER_URL|http://localhost:5002|$PROD_URL"
  "$ROOT/soromanfe/.env|VITE_API_URL|http://localhost:5002/api|$PROD_URL/api"
  "$ROOT/soroman-frontend/apps/web/.env|VITE_SERVER_URL|http://localhost:5002|$PROD_URL"
  "$ROOT/soroman-frontend/apps/native/.env|EXPO_PUBLIC_SERVER_URL|http://$LAN_IP:5002|$PROD_URL"
  "$ROOT/soroman-mobile-app/.env|EXPO_PUBLIC_API_BASE_URL|http://$LAN_IP:5002|$PROD_URL"
)

case "$MODE" in
  prod|local|status) ;;
  *) echo "Usage: $0 [prod|local|status]" >&2; exit 1 ;;
esac

printf '%-42s %-26s %s\n' "APP" "VARIABLE" "VALUE"
printf '%-42s %-26s %s\n' "---" "--------" "-----"

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r file var local_value prod_value <<<"$entry"
  name="${file#"$ROOT/"}"

  if [ ! -f "$file" ]; then
    printf '%-42s %-26s %s\n' "$name" "$var" "(no .env — skipped)"
    continue
  fi

  if [ "$MODE" = "status" ]; then
    printf '%-42s %-26s %s\n' "$name" "$var" "$(grep -E "^$var=" "$file" | head -1 | cut -d= -f2- || echo '(unset)')"
    continue
  fi

  [ "$MODE" = "prod" ] && want="$prod_value" || want="$local_value"

  cp "$file" "$file.backup-$(date +%Y%m%d-%H%M%S)"
  if grep -qE "^$var=" "$file"; then
    # BSD sed. The value can contain / and :, so use | as the delimiter.
    sed -i '' -E "s|^$var=.*|$var=$want|" "$file"
  else
    printf '\n%s=%s\n' "$var" "$want" >> "$file"
  fi
  printf '%-42s %-26s %s\n' "$name" "$var" "$want"
done

if [ "$MODE" != "status" ]; then
  echo
  echo "Vite and Expo read .env once at boot — restart every dev server for this to take effect."
  [ "$MODE" = "prod" ] && echo "These apps now read PRODUCTION data. Writes are real."
fi
