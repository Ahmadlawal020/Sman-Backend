-- A wallet is a single pooled balance — nothing today records which credit
-- deposit(s) actually funded a given order, only that the pool had enough.
-- This adds a FIFO consumption ledger, additive to the existing balance
-- mechanism (it never gates or can fail a payment — see wallet.service.js):
-- each credit deposit tracks how much of itself is still unclaimed, and each
-- order records exactly which deposit(s) it drew from and how much.
--
-- NULL on `remaining_amount` means "predates this feature, not tracked" —
-- deliberately distinct from 0 ("tracked, and now fully spent"). Nothing is
-- backfilled: orders paid before this shipped simply have no allocation rows.

ALTER TABLE "deposits" ADD COLUMN "remaining_amount" numeric(15, 2);
--> statement-breakpoint

CREATE TABLE "order_deposit_allocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "deposit_id" integer NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_deposit_allocations" ADD CONSTRAINT "order_deposit_allocations_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_deposit_allocations" ADD CONSTRAINT "order_deposit_allocations_deposit_id_deposits_id_fk"
  FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "order_deposit_allocations_order_deposit_idx" ON "order_deposit_allocations" ("order_id", "deposit_id");
--> statement-breakpoint
CREATE INDEX "order_deposit_allocations_deposit_idx" ON "order_deposit_allocations" ("deposit_id");
