# Legacy migrations — do not run

These files describe the schema history of the old clean-room database
(`soroman_dashboard` on Neon), not `soroman_db`. They are kept here for
historical reference only.

`soroman_db` is shared production, owned and migrated by Django
(`soroman_backend-2`). Its schema authority is Django's `django_migrations`
table. Drizzle in this repo is a read/write consumer of that existing schema,
never its migrator — there is no equivalent migration folder for it and there
should never be one.

Do not run `drizzle-kit migrate` / `generate` / `push` against anything in
this folder or against `soroman_db`. See `docs/LIVE_DB_CUTOVER.md`.
