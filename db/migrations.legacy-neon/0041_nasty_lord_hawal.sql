CREATE TYPE "public"."expense_status" AS ENUM('pending', 'verified', 'audit_approved', 'admin_approved', 'paid', 'rejected', 'changes_requested');--> statement-breakpoint
CREATE TABLE "pfi_expense_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" varchar(255) DEFAULT '',
	"content_type" varchar(120) DEFAULT '',
	"size_bytes" integer DEFAULT 0,
	"uploaded_by" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "receipt_reference" varchar(100) DEFAULT '';--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payee_bank_name" varchar(200) DEFAULT '';--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payee_account_number" varchar(50) DEFAULT '';--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payee_account_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "status" "expense_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "verified_by" integer;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "audit_approved_by" integer;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "audit_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "admin_approved_by" integer;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "admin_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "paid_by" integer;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "review_note" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "added_by" integer;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "edited_by" integer;--> statement-breakpoint
ALTER TABLE "pfi_expense_attachments" ADD CONSTRAINT "pfi_expense_attachments_expense_id_pfi_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."pfi_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expense_attachments" ADD CONSTRAINT "pfi_expense_attachments_uploaded_by_staff_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pfi_expense_attachments_expense_idx" ON "pfi_expense_attachments" USING btree ("expense_id");--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_verified_by_staff_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_audit_approved_by_staff_id_fk" FOREIGN KEY ("audit_approved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_admin_approved_by_staff_id_fk" FOREIGN KEY ("admin_approved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_paid_by_staff_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_added_by_staff_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_edited_by_staff_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pfi_expenses_status_idx" ON "pfi_expenses" USING btree ("status");
--> statement-breakpoint
-- Everything already on the books predates the approval chain: it was entered
-- as spending that had already happened, not as a request awaiting sign-off.
-- Without this backfill the column default ('pending') would drop every one of
-- them out of `total_expenses` the moment cost switches to PAID-only, and every
-- cargo's landing cost and profit would move overnight for no real reason.
--
-- New rows still start at 'pending' and must walk the chain.
UPDATE pfi_expenses
   SET status = 'paid',
       paid_at = COALESCE(paid_at, created_at),
       reviewed_at = COALESCE(reviewed_at, created_at)
 WHERE status = 'pending';
