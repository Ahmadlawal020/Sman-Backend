-- A human reference for a request that so far only had its internal serial
-- id. Generated, not computed and stored from application code, so it can
-- never drift from the row it names or collide with another: `id` is already
-- unique by virtue of being the primary key, so no separate counter/sequence
-- is needed and no race condition is possible. Based on `created_at`, not the
-- editable `expense_date`, so correcting an expense's date can never change
-- its own reference after the fact.

-- EXTRACT(... FROM timestamptz) alone is not immutable — its result depends
-- on the session's TimeZone setting, which Postgres will not allow inside a
-- generated column. Converting through a fixed zone literal first pins the
-- computation so it no longer depends on any session setting.
ALTER TABLE "pfi_expenses" ADD COLUMN "reference_number" varchar(20) GENERATED ALWAYS AS (
  'EXP-' || EXTRACT(YEAR FROM "created_at" AT TIME ZONE 'UTC')::int::text || '-' || LPAD("id"::text, 6, '0')
) STORED;
--> statement-breakpoint
CREATE UNIQUE INDEX "pfi_expenses_reference_number_idx" ON "pfi_expenses" ("reference_number");
