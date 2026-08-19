# Deploying Sman-Backend onto the existing EC2 host

Runs Sman-Backend (Node/Express) alongside Django on the same EC2 instance
that already serves `ordersoroman.com` / `api.ordersoroman.com`, then repoints
`api.ordersoroman.com` at it once verified. Django keeps owning the database
(migrations, admin, Celery jobs) — this only changes which process answers
the API domain's HTTP traffic.

Every step here is meant to be run by hand over SSH, in order. Nothing here
is automated — no script does this for you, and nothing here touches
production until you run the commands yourself.

## Phase 0 — prerequisites on the box

```bash
node -v        # need >=20; if missing or older, install Node 20+ first
                # (nvm, or NodeSource's setup script, whichever the box
                # already uses for anything else Node-based)
which nginx     # confirm nginx is what's actually terminating TLS/routing
                # api.ordersoroman.com today — this runbook assumes it is,
                # per Django's gunicorn+nginx setup
sudo cat /etc/nginx/sites-enabled/*  # find the existing api.ordersoroman.com
                # server block so step 3 edits the right file
```

## Phase 1 + 2 — install, start, verify (one script)

`deploy/setup.sh` does all of this in one shot: clone-or-pull, `npm ci`,
install the systemd unit, start it, and health-check it. It refuses to
overwrite or guess at `.env` — you write that by hand first (it's the one
part with real secrets in it), then the script picks up from there.

```bash
# 1. Get .env in place first — copy deploy/env.production.example's
#    contents (from this repo, e.g. `cat deploy/env.production.example`
#    locally and paste it over SSH, or scp the file up) to
#    ~/sman-backend/.env on the EC2 box, then fill in every blank:
#      - DATABASE_URL: see below, use the real value
#      - STAFF_ACCESS_TOKEN_SECRET / CUSTOMER_ACCESS_TOKEN_SECRET: run
#          node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
#        twice, once per line — they must be DIFFERENT values
#      - RESEND_API_KEY / TERMII_API_KEY / CLOUDINARY_*: the same real
#        values already in Django's own .env on this box (cat it to copy)

# THE live database — this exact value is already known-good, verified
# working against production earlier in this repo's own setup:
#   DATABASE_URL=postgresql://soroman_user:<password>@35.180.19.138:5432/soroman_db
# (a real host, not this box's own loopback — don't substitute 127.0.0.1
# unless you've separately confirmed Postgres runs on this same instance)

# 2. Run the script:
cd ~
git clone <this repo's URL> sman-backend    # first time only
cd sman-backend
./deploy/setup.sh
# (if ~/sman-backend already exists from a prior run, just: cd ~/sman-backend && ./deploy/setup.sh)
```

It ends with a `curl http://127.0.0.1:5002/api/health` and tells you
pass/fail. If it fails, it points you at `journalctl -u sman-backend` to see
why — fix `.env`, then re-run `./deploy/setup.sh` (safe to run repeatedly).

**Do not open port 5002 in the EC2 security group.** Node's `app.listen()`
binds all interfaces by default, but as long as only 80/443 are open at the
firewall, the app is only reachable from the box itself — that's the whole
safety property of this phase. The script never touches nginx or the
security group; that's Phase 3, deliberately separate and manual.

## Phase 3 — expose it externally on a side path first

Add a **separate** nginx server block on a subdomain that isn't
`api.ordersoroman.com` yet, so you can hit it over real HTTPS from outside
without touching live traffic. If `sman-staging.ordersoroman.com` (or
similar) doesn't have a DNS record yet, add one (A record, same IP as
`api.ordersoroman.com`) before this step.

```nginx
server {
    listen 443 ssl;
    server_name sman-staging.ordersoroman.com;

    # reuse the same cert Django's server block uses if it's a wildcard,
    # otherwise issue a new one: sudo certbot --nginx -d sman-staging.ordersoroman.com

    location / {
        proxy_pass http://127.0.0.1:5002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s https://sman-staging.ordersoroman.com/api/health
```

Now point a real client at it — e.g. change `soroman_web`'s or the mobile
app's API base URL to this staging host in a local/dev build, and run through
placing an order end to end. This is the actual pre-cutover check: real
HTTPS, real client code, real live data, just not the production domain yet.

## Phase 4 — the cutover

Once phase 3 has held up, edit the **existing** `api.ordersoroman.com`
server block found in Phase 0 and change its `location` blocks' `proxy_pass`
from Django's gunicorn upstream to `http://127.0.0.1:5002`, matching the
`location / { ... }` shape above.

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s https://api.ordersoroman.com/api/health
```

From this moment, everything hitting `api.ordersoroman.com` — the customer
portal, the mobile app, the admin dashboard, WhatsApp webhooks, whatever
already points at that domain — is served by Sman-Backend, reading and
writing the same live database Django's `manage.py migrate` still owns.

**Rollback**, if anything looks wrong: revert that one `proxy_pass` line back
to gunicorn's upstream, `sudo nginx -t && sudo systemctl reload nginx`. Takes
seconds, and nothing about Sman-Backend running is destructive to Django or
the data — it's a pure read/write API layer swap.

## What Django keeps doing after the cutover

- Owns and runs all schema migrations (`manage.py migrate`) — Sman-Backend's
  own `db:migrate` etc. remain permanently disabled stubs by design (see
  `docs/LIVE_DB_CUTOVER.md`).
- Keeps running Celery worker + beat for whatever background jobs are
  Django-native (reports, scheduled tasks) — Sman-Backend has its own
  separate job queue (pg-boss) for its own background work, unrelated to
  Celery.
- The Django admin UI, if anyone still uses it directly, keeps working
  exactly as before — only the *API* domain moved, not the database or
  Django's own admin surface.

## Ongoing deploys after this

For the *first* cutover, everything above is manual by design. Once
`~/sman-backend` and the `sman-backend` systemd service exist on the box
(Phase 1), `.github/workflows/deploy.yml` in this repo takes over future
pushes to `main` — it SSHs in, pulls, `npm ci`, restarts the service, health
checks it, and rolls back automatically if the restart fails. It's already
in the repo but does nothing yet: it needs three secrets added to this
GitHub repo (**Settings → Secrets and variables → Actions**):

- `EC2_HOST` — same value as Django's repo secret of the same name
- `EC2_USER` — same value as Django's
- `EC2_SSH_KEY` — same value as Django's (the private key that can SSH into
  the box) — copy these three from `soroman_backend-2`'s repo secrets if you
  have access there, since it's the same box and the same login

Once those three are set, every push to `main` deploys automatically —
mirroring exactly how Django's own repo already deploys itself.
