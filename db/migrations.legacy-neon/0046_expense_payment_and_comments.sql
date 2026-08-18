-- Two things the approval chain was missing.
--
-- 1. What was actually paid. `amount` is what the request asked for; the
--    Expenditure Officer settles it at the end, and the two are not always the
--    same. `amount_paid` stays NULL until then, so "not yet paid" and "paid
--    nothing" never read alike, and every total falls back to `amount` for
--    rows that predate this.
--
-- 2. A conversation. Review notes are one-way and get overwritten; a request
--    that is queried needs the person who raised it to be able to answer.

ALTER TABLE "pfi_expenses" ADD COLUMN "amount_paid" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payment_reference" varchar(100) DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Rows already marked paid were settled in full by definition — there was no
-- way to record anything else.
UPDATE "pfi_expenses" SET "amount_paid" = "amount" WHERE "status" = 'paid';
--> statement-breakpoint

CREATE TABLE "pfi_expense_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "expense_id" integer NOT NULL,
  "body" text NOT NULL,
  "author_id" integer,
  -- Kept alongside the FK so a comment still reads correctly after the author
  -- leaves and the staff row is cleared.
  "author_name" varchar(255) DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pfi_expense_comments" ADD CONSTRAINT "pfi_expense_comments_expense_id_pfi_expenses_id_fk"
  FOREIGN KEY ("expense_id") REFERENCES "public"."pfi_expenses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pfi_expense_comments" ADD CONSTRAINT "pfi_expense_comments_author_id_staff_id_fk"
  FOREIGN KEY ("author_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pfi_expense_comments_expense_idx" ON "pfi_expense_comments" ("expense_id", "created_at");
