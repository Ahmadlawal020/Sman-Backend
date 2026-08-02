-- order_pfi_allocations is created by 0030_whole_epoch.sql with the canonical
-- shape (cascade FKs + a unique (order_id, pfi_id) index), which the schema in
-- db/schema/orderPfiAllocation.js reflects. This migration created the same
-- table on an earlier branch; after main renumbered it (0029 -> 0032) both
-- files ended up in the journal, so a plain CREATE here fails with
-- "relation already exists". Reduced to a guarded no-op: 0030 always runs first
-- (it precedes 0032 in the journal), so on every environment this is a no-op,
-- and it stays safe on any DB that somehow predates 0030.
CREATE TABLE IF NOT EXISTS "order_pfi_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"pfi_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
