CREATE TABLE "expected_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"order_id" integer,
	"depot_id" integer,
	"pfi_id" integer,
	"expected_amount" numeric(15, 2),
	"reference" varchar(255) DEFAULT '',
	"note" text DEFAULT '',
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"matched_deposit_id" integer,
	"created_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pfi_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"pfi_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "pfi_expense_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" integer NOT NULL,
	"body" text NOT NULL,
	"author_id" integer,
	"author_name" varchar(255) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_deposit_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"deposit_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_page_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"route_path" varchar(100) NOT NULL,
	"allowed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_otps" ADD COLUMN "purpose" varchar(32) DEFAULT 'auth' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "depot_id" integer;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "pfi_id" integer;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "remaining_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "can_view_all_locations" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pfis" ADD COLUMN "bl_qty_mt" real;--> statement-breakpoint
ALTER TABLE "pfis" ADD COLUMN "credit_balance" numeric(15, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "gl_code" varchar(20);--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "gl_group" varchar(40);--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "gl_subgroup" varchar(60) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "vendor_id" integer;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "tin_number" varchar(30) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "invoice_number" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "amount_ex_vat" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "vat_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "invoice_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "wht_deduction" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "wht_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "amount_paid" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payment_reference" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payment_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payment_method" varchar(30) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "payment_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "bank_code" varchar(20) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "reference_number" varchar(20) GENERATED ALWAYS AS ('EXP-' || EXTRACT(YEAR FROM created_at AT TIME ZONE 'UTC')::int::text || '-' || LPAD(id::text, 6, '0')) STORED;--> statement-breakpoint
ALTER TABLE "pfi_expense_attachments" ADD COLUMN "type" varchar(30);--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_matched_deposit_id_deposits_id_fk" FOREIGN KEY ("matched_deposit_id") REFERENCES "public"."deposits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_staff" ADD CONSTRAINT "pfi_staff_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_staff" ADD CONSTRAINT "pfi_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expense_comments" ADD CONSTRAINT "pfi_expense_comments_expense_id_pfi_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."pfi_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expense_comments" ADD CONSTRAINT "pfi_expense_comments_author_id_staff_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_deposit_allocations" ADD CONSTRAINT "order_deposit_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_deposit_allocations" ADD CONSTRAINT "order_deposit_allocations_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_page_overrides" ADD CONSTRAINT "staff_page_overrides_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expected_payments_customer_status_idx" ON "expected_payments" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "expected_payments_order_idx" ON "expected_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pfi_staff_unique_idx" ON "pfi_staff" USING btree ("pfi_id","staff_id");--> statement-breakpoint
CREATE INDEX "pfi_staff_pfi_idx" ON "pfi_staff" USING btree ("pfi_id");--> statement-breakpoint
CREATE INDEX "pfi_staff_staff_idx" ON "pfi_staff" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_idx" ON "vendors" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "pfi_expense_comments_expense_idx" ON "pfi_expense_comments" USING btree ("expense_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_deposit_allocations_order_deposit_idx" ON "order_deposit_allocations" USING btree ("order_id","deposit_id");--> statement-breakpoint
CREATE INDEX "order_deposit_allocations_deposit_idx" ON "order_deposit_allocations" USING btree ("deposit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_page_overrides_unique_idx" ON "staff_page_overrides" USING btree ("staff_id","route_path");--> statement-breakpoint
CREATE INDEX "staff_page_overrides_staff_idx" ON "staff_page_overrides" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_gl_code_idx" ON "expense_categories" USING btree ("gl_code") WHERE "expense_categories"."gl_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pfi_expenses_vendor_idx" ON "pfi_expenses" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pfi_expenses_reference_number_idx" ON "pfi_expenses" USING btree ("reference_number");