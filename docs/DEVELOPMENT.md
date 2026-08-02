# Development notes

## Test database

Tests run against **`TEST_DATABASE_URL`** — a separate, disposable database,
never `DATABASE_URL`. `db/index.js` refuses a remote test DB unless
`TEST_DATABASE_URL` is set (or `ALLOW_TESTS_ON_DEV_DB=true`), so a test run can't
touch shared data.

`npm test` also runs with `SMS_ENABLED=false`, so no test reaches Termii; the
`external-boundaries` suite re-enables SMS locally and blocks real network so a
mismatched mock fails loudly instead of hitting production.

### Resetting it

When local migrations diverge (e.g. after a merge that renumbered one of yours),
reset the test DB to the clean, fully-migrated state CI always has:

```
npm run db:reset-test
```

This drops and recreates the schema, then applies every migration in order. It
refuses to run against anything but a localhost `TEST_DATABASE_URL`.

## Migrations

- Generate with `npm run db:generate`. **Never hand-edit an applied migration** —
  it changes drizzle's hash and breaks already-migrated databases.
- `npm run check:migrations` (also a CI step) fails when two migrations share an
  index — the collision that happens when two branches each add, say, `0023_*`.
  After merging the latest `main`, regenerate yours so it takes the next free
  number.
- **Apply migrations only against fresh or CI databases**, never a shared dev DB.
  Applying an un-renumbered local migration to a shared DB leaves it drifted from
  the committed chain.

### Optional pre-push guard

To catch a duplicate migration number before you push (rather than in CI), enable
the versioned hook once per clone:

```
git config core.hooksPath .githooks
```

## LPG inventory — two concepts

LPG stock is tracked in two independent places; don't conflate them:

- **`lpg_station_cylinders`** — per-station cylinder counts by size. This is the
  source of truth for order fulfilment: decremented when an order request is
  **approved** and returned to stock when it is **cancelled**
  (`incrementCylinderQuantity`).
- **`pfis.lpg_station_id`** — bulk PFI lots attached to a station, using the same
  proforma-invoice mechanism the fuel depots use. Separate from the cylinder
  counts above.
