-- What the payment-recording step still needed: when it was paid (as opposed
-- to when the mark-paid click happened), how it was paid, and room for the
-- Expenditure Officer to explain a variance. `payment_date` is editable by
-- whoever records payment — the teller date on a bank slip is often a day or
-- two off from the moment someone logs in and clicks "mark paid" — while
-- `paid_at` (added in 0046, via the STAGE_STAMPS pair) keeps recording the
-- actual system timestamp of the action, untouched.

ALTER TABLE "pfi_expenses" ADD COLUMN "payment_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payment_method" varchar(30) DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payment_notes" text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Rows already marked paid before this column existed: back-fill payment_date
-- from paid_at so nothing reads as "no payment date" for a settled request.
UPDATE "pfi_expenses" SET "payment_date" = "paid_at" WHERE "status" = 'paid' AND "paid_at" IS NOT NULL;
--> statement-breakpoint

-- Lets an upload declare what it is (invoice, receipt, payment evidence, ...)
-- instead of every attachment reading as an undifferentiated pile of files.
ALTER TABLE "pfi_expense_attachments" ADD COLUMN "type" varchar(30);
