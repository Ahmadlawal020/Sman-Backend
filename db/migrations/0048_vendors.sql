-- Vendor master data.
--
-- Every expense so far has carried `vendor` as a free-typed string — no two
-- requests for the same supplier were guaranteed to spell the name the same
-- way, and there was no single place to ask "how much have we paid this
-- vendor" or "what is still outstanding to them". This table is that place.
-- `pfi_expenses.vendor` stays as-is: it becomes a snapshot of the vendor's
-- name at the time the expense was raised, not a live lookup, so renaming a
-- vendor later never rewrites history.

CREATE TABLE "vendors" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "contact_person" varchar(255) DEFAULT '',
  "phone" varchar(50) DEFAULT '',
  "email" varchar(255) DEFAULT '',
  "address" text DEFAULT '',
  "bank_name" varchar(200) DEFAULT '',
  "account_number" varchar(50) DEFAULT '',
  "account_name" varchar(255) DEFAULT '',
  "tax_id" varchar(50) DEFAULT '',
  "status" varchar(20) DEFAULT 'Active' NOT NULL,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_created_by_staff_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_idx" ON "vendors" (lower("name"));
--> statement-breakpoint

ALTER TABLE "pfi_expenses" ADD COLUMN "vendor_id" integer;
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_vendor_id_vendors_id_fk"
  FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pfi_expenses_vendor_idx" ON "pfi_expenses" ("vendor_id");
