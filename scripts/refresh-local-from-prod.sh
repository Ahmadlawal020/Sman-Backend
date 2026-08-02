#!/bin/bash
#
# Pull live production data into the local `soroman_real` database.
#
#   npm run db:refresh          (or: bash scripts/refresh-local-from-prod.sh)
#
# Production is only ever READ. Every write in this script targets the local
# database. Run it whenever you want local to match live again.
#
# Requires PROD_DATABASE_URL in .env (or the environment). Neon runs a newer
# Postgres than the Homebrew client, so this copies via psql COPY rather than
# pg_dump, which refuses to run across a version gap.
#
set -euo pipefail

LOCAL_DB="${LOCAL_DB:-soroman_real}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# --- resolve the production URL -------------------------------------------
read_env() { [ -f .env ] && grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
[ -z "${PROD_DATABASE_URL:-}" ] && PROD_DATABASE_URL="$(read_env PROD_DATABASE_URL)"
# The refresh overwrites staff with production's password hashes, so the local
# login has to be re-established every time — not just on first run.
[ -z "${DEV_LOGIN_EMAIL:-}" ]    && DEV_LOGIN_EMAIL="$(read_env DEV_LOGIN_EMAIL)"
[ -z "${DEV_LOGIN_PASSWORD:-}" ] && DEV_LOGIN_PASSWORD="$(read_env DEV_LOGIN_PASSWORD)"
if [ -z "${PROD_DATABASE_URL:-}" ]; then
  echo "PROD_DATABASE_URL is not set (put it in .env). Aborting." >&2
  exit 1
fi
# verify-full needs a CA bundle; use the system trust store rather than
# weakening verification.
case "$PROD_DATABASE_URL" in
  *sslrootcert=*) ;;
  *\?*) PROD_DATABASE_URL="${PROD_DATABASE_URL}&sslrootcert=system" ;;
  *)    PROD_DATABASE_URL="${PROD_DATABASE_URL}?sslrootcert=system" ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "→ workspace $WORK"

# --- safety: refuse to run if the target looks remote ----------------------
case "$LOCAL_DB" in
  *amazonaws*|*neon.tech*|*://*)
    echo "LOCAL_DB must be a local database name, not a URL. Aborting." >&2
    exit 1 ;;
esac

echo "→ reading production schema (read-only)"
psql "$PROD_DATABASE_URL" -tAc "
  select t.tablename||'|'||string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
  from pg_tables t
  join information_schema.columns c
    on c.table_schema='public' and c.table_name=t.tablename
  where t.schemaname='public'
  group by t.tablename order by t.tablename;" > "$WORK/prod-meta.txt"

psql -d "$LOCAL_DB" -tAc "
  select t.tablename||'|'||string_agg(c.column_name, ',' order by c.ordinal_position)
  from pg_tables t
  join information_schema.columns c
    on c.table_schema='public' and c.table_name=t.tablename
  where t.schemaname='public' group by t.tablename;" > "$WORK/local-meta.txt"

# --- build copy scripts over the column intersection -----------------------
# Local is usually ahead of production, so only columns present in BOTH are
# copied; anything local-only is left at its default (which is the point of
# nullable columns like bl_qty_litres).
python3 - "$WORK" <<'PY'
import os, sys
work = sys.argv[1]
local = {}
for line in open(f'{work}/local-meta.txt'):
    if '|' not in line: continue
    t, c = line.strip().split('|', 1)
    local[t] = set(c.split(','))

os.makedirs(f'{work}/csv', exist_ok=True)
exp, imp, skipped = [], [], []
for line in open(f'{work}/prod-meta.txt'):
    if '|' not in line: continue
    t, c = line.strip().split('|', 1)
    if t not in local:
        skipped.append(t); continue
    cols = [x for x in c.split(',') if x.strip('"') in local[t]]
    if not cols:
        skipped.append(t); continue
    sel = ','.join(cols)
    exp.append(f'\\copy (select {sel} from public."{t}") to \'{work}/csv/{t}.csv\' csv')
    imp.append((t, sel))

open(f'{work}/export.psql', 'w').write('\n'.join(exp) + '\n')
with open(f'{work}/import.psql', 'w') as f:
    f.write('begin;\nset local session_replication_role = replica;\n')
    for t, _ in imp:
        f.write(f'truncate table public."{t}" cascade;\n')
    for t, sel in imp:
        f.write(f'\\copy public."{t}" ({sel}) from \'{work}/csv/{t}.csv\' csv\n')
    f.write('commit;\n')
print(f'  {len(imp)} tables to copy' + (f'; skipping (not in local schema): {", ".join(skipped)}' if skipped else ''))
PY

echo "→ exporting production data (read-only, single connection)"
psql "$PROD_DATABASE_URL" -q -f "$WORK/export.psql"

echo "→ loading into local '$LOCAL_DB'"
psql -d "$LOCAL_DB" -q -v ON_ERROR_STOP=1 -f "$WORK/import.psql"

echo "→ resetting sequences"
# Ids arrive explicitly, so every serial sequence is still at 1 until fixed.
# Without this the next insert collides with an existing row.
psql -d "$LOCAL_DB" -tAc "
select setval(pg_get_serial_sequence(quote_ident(t.table_name), c.column_name),
       coalesce((xpath('/row/max/text()',
         query_to_xml(format('select max(%I) as max from public.%I', c.column_name, t.table_name),
                      false, true, '')))[1]::text::bigint, 0) + 1, false)
from information_schema.tables t
join information_schema.columns c
  on c.table_schema='public' and c.table_name=t.table_name
where t.table_schema='public'
  and pg_get_serial_sequence(quote_ident(t.table_name), c.column_name) is not null;" > /dev/null

echo "→ ensuring every PFI has its expense category"
psql -d "$LOCAL_DB" -tAc "
insert into expense_categories (name, pfi_id, is_system_category)
select p.pfi_number, p.id, true from pfis p
left join expense_categories c on c.pfi_id = p.id
where c.id is null on conflict do nothing;" > /dev/null

# --- local-only dev login --------------------------------------------------
# Production password hashes come across as-is and nobody knows them locally.
# This sets a known one on the local copy only; production is never written to.
if [ -n "${DEV_LOGIN_EMAIL:-}" ]; then
  echo "→ setting local dev password for $DEV_LOGIN_EMAIL"
  DEV_LOGIN_EMAIL="$DEV_LOGIN_EMAIL" \
  DEV_LOGIN_PASSWORD="${DEV_LOGIN_PASSWORD:-DevPassword123!}" \
  LOCAL_DB="$LOCAL_DB" node -e '
    const postgres = require("postgres"); const bcrypt = require("bcrypt");
    const sql = postgres(`postgresql://${process.env.USER}@localhost/${process.env.LOCAL_DB}`, { max: 1 });
    (async () => {
      const h = await bcrypt.hash(process.env.DEV_LOGIN_PASSWORD, 12);
      const r = await sql`update staff set password=${h}, is_password_set=true, is_active=true
                          where email=${process.env.DEV_LOGIN_EMAIL} returning email`;
      console.log(r.length ? `  ok: ${r[0].email}` : "  (no such staff row)");
      await sql.end();
    })();'
fi

echo
psql -d "$LOCAL_DB" -tAc "
select '✓ local now has: pfis='||(select count(*) from pfis)
     ||'  orders='||(select count(*) from orders)
     ||'  customers='||(select count(*) from customers)
     ||'  expenses='||(select count(*) from pfi_expenses where deleted_at is null)
     ||'  movements='||(select count(*) from pfi_movements);"
echo "Production was only read. Nothing was written to it."
