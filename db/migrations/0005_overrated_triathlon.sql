CREATE TYPE "public"."audit_actor_type" AS ENUM('staff', 'customer', 'system');--> statement-breakpoint
CREATE TYPE "public"."ledger_owner_type" AS ENUM('delivery_customer', 'filling_station', 'fleet_truck');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."ledger_category" AS ENUM('opening_balance', 'sale', 'purchase', 'payment', 'credit_note', 'debit_note', 'discount', 'adjustment', 'expense', 'income', 'fuel', 'repairs', 'tyres', 'maintenance', 'driver_allowance', 'toll', 'insurance', 'registration', 'commission', 'other');--> statement-breakpoint
CREATE TYPE "public"."daily_report_status" AS ENUM('submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('incident', 'expense', 'maintenance', 'observation', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('submitted', 'reviewed', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."offline_sale_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('pending', 'confirmed', 'released');--> statement-breakpoint
ALTER TYPE "public"."delivery_customer_type" ADD VALUE 'third_party';--> statement-breakpoint
ALTER TYPE "public"."delivery_customer_type" ADD VALUE 'bulk';--> statement-breakpoint
ALTER TYPE "public"."delivery_customer_type" ADD VALUE 'retail';--> statement-breakpoint
ALTER TYPE "public"."delivery_customer_type" ADD VALUE 'wholesale';--> statement-breakpoint
ALTER TYPE "public"."delivery_customer_type" ADD VALUE 'corporate';--> statement-breakpoint
ALTER TYPE "public"."delivery_customer_type" ADD VALUE 'government';--> statement-breakpoint
ALTER TYPE "public"."delivery_customer_type" ADD VALUE 'other';--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" varchar(100) NOT NULL,
	"actor_type" "audit_actor_type" DEFAULT 'system' NOT NULL,
	"actor_id" integer,
	"actor_name" varchar(255) DEFAULT '',
	"entity_type" varchar(100) DEFAULT '',
	"entity_id" varchar(64) DEFAULT '',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_date" date NOT NULL,
	"location" varchar(255) NOT NULL,
	"pfi_number" varchar(50) DEFAULT '' NOT NULL,
	"product_name" varchar(100) DEFAULT '',
	"carried_over_loading" numeric(15, 2) DEFAULT '0',
	"opening_stock" numeric(15, 2) DEFAULT '0',
	"received_stock" numeric(15, 2) DEFAULT '0',
	"litres_sold" numeric(15, 2) DEFAULT '0' NOT NULL,
	"tank_balance" numeric(15, 2) DEFAULT '0',
	"loading_left_over" numeric(15, 2) DEFAULT '0',
	"price_bands" jsonb DEFAULT '[]'::jsonb,
	"avg_price" numeric(12, 2) DEFAULT '0',
	"total_sales_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(15, 2) DEFAULT '0' NOT NULL,
	"differentials" numeric(15, 2) DEFAULT '0',
	"truck_count" integer DEFAULT 0 NOT NULL,
	"bank_name" varchar(255) DEFAULT '',
	"account_number" varchar(50) DEFAULT '',
	"remarks" text DEFAULT '',
	"status" "daily_report_status" DEFAULT 'submitted' NOT NULL,
	"submitted_by" integer,
	"submitted_by_name" varchar(255) DEFAULT '',
	"reviewed_by" integer,
	"reviewed_by_name" varchar(255) DEFAULT '',
	"reviewed_at" timestamp with time zone,
	"review_comment" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reports_litres_check" CHECK ("daily_reports"."litres_sold" >= 0),
	CONSTRAINT "daily_reports_trucks_check" CHECK ("daily_reports"."truck_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_trucks" (
	"id" serial PRIMARY KEY NOT NULL,
	"plate_number" varchar(50) NOT NULL,
	"truck_make" varchar(255) DEFAULT '',
	"chassis_number" varchar(255) DEFAULT '',
	"max_capacity" integer,
	"fuel_capacity" real,
	"avg_litres_per_trip" real,
	"mileage" integer,
	"driver_name" varchar(255) DEFAULT '',
	"driver_phone" varchar(50) DEFAULT '',
	"driver_alt_phone" varchar(50) DEFAULT '',
	"motor_boy_name" varchar(255) DEFAULT '',
	"motor_boy_phone" varchar(50) DEFAULT '',
	"spare_driver_name" varchar(255) DEFAULT '',
	"spare_driver_phone" varchar(50) DEFAULT '',
	"insurance_expiry" date,
	"road_worthiness_expiry" date,
	"last_service_date" date,
	"next_service_date" date,
	"documents" jsonb DEFAULT '[]'::jsonb,
	"passport_photo" text DEFAULT '',
	"truck_status" varchar(500) DEFAULT '',
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '',
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_trucks_mileage_check" CHECK ("fleet_trucks"."mileage" IS NULL OR "fleet_trucks"."mileage" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"fleet_truck_id" integer NOT NULL,
	"trip_date" date NOT NULL,
	"origin" varchar(255) DEFAULT '',
	"destination" varchar(255) DEFAULT '',
	"allocation_code" varchar(100) DEFAULT '',
	"quantity_litres" real,
	"fuel_used_litres" real,
	"mileage_start" integer,
	"mileage_end" integer,
	"driver_name" varchar(255) DEFAULT '',
	"notes" text DEFAULT '',
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_trips_mileage_check" CHECK ("fleet_trips"."mileage_end" IS NULL OR "fleet_trips"."mileage_start" IS NULL OR "fleet_trips"."mileage_end" >= "fleet_trips"."mileage_start")
);
--> statement-breakpoint
CREATE TABLE "incident_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_type" "incident_type" NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"location" varchar(255) DEFAULT '',
	"amount" numeric(15, 2),
	"pfi_id" integer,
	"pfi_number" varchar(100) DEFAULT '',
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb,
	"status" "incident_status" DEFAULT 'submitted' NOT NULL,
	"status_note" text DEFAULT '',
	"submitted_by" integer,
	"submitted_by_name" varchar(255) DEFAULT '',
	"reviewed_by" integer,
	"reviewed_by_name" varchar(255) DEFAULT '',
	"reviewed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_records_amount_check" CHECK ("incident_records"."amount" IS NULL OR "incident_records"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_type" "ledger_owner_type" NOT NULL,
	"owner_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"running_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"category" "ledger_category" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" text DEFAULT '',
	"reference" varchar(255) DEFAULT '',
	"entry_date" date NOT NULL,
	"balance_after" numeric(15, 2) NOT NULL,
	"metadata" jsonb,
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_check" CHECK ("ledger_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "offline_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_number" varchar(50) NOT NULL,
	"state" varchar(100) DEFAULT '',
	"location" varchar(255) DEFAULT '',
	"customer_name" varchar(255) DEFAULT '',
	"customer_phone" varchar(50) DEFAULT '',
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(15, 2) DEFAULT '0' NOT NULL,
	"payment_status" "order_payment_status" DEFAULT 'Unpaid' NOT NULL,
	"payment_bank" varchar(255) DEFAULT '',
	"payment_reference" varchar(255) DEFAULT '',
	"status" "offline_sale_status" DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"rejection_reason" text DEFAULT '',
	"reconciled" boolean DEFAULT false NOT NULL,
	"reconciled_by" integer,
	"reconciled_at" timestamp with time zone,
	"notes" text DEFAULT '',
	"created_by" integer,
	"created_by_name" varchar(255) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sales_amounts_check" CHECK ("offline_sales"."total_amount" >= 0 AND "offline_sales"."amount_paid" >= 0)
);
--> statement-breakpoint
CREATE TABLE "offline_sale_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"offline_sale_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"line_total" numeric(15, 2) NOT NULL,
	CONSTRAINT "offline_sale_items_quantity_check" CHECK ("offline_sale_items"."quantity" > 0),
	CONSTRAINT "offline_sale_items_price_check" CHECK ("offline_sale_items"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_customers" ADD COLUMN "contacts" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "delivery_customers" ADD COLUMN "addresses" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "release_status" "release_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "confirmed_by" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "released_by" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "rejection_reason" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "ticket_number" varchar(100) DEFAULT '';--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "ticket_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD COLUMN "is_fully_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submitted_by_staff_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD CONSTRAINT "fleet_trucks_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_fleet_truck_id_fleet_trucks_id_fk" FOREIGN KEY ("fleet_truck_id") REFERENCES "public"."fleet_trucks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_records" ADD CONSTRAINT "incident_records_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_records" ADD CONSTRAINT "incident_records_submitted_by_staff_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_records" ADD CONSTRAINT "incident_records_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_reconciled_by_staff_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_items" ADD CONSTRAINT "offline_sale_items_offline_sale_id_offline_sales_id_fk" FOREIGN KEY ("offline_sale_id") REFERENCES "public"."offline_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_items" ADD CONSTRAINT "offline_sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_unique_idx" ON "daily_reports" USING btree ("report_date","location","pfi_number","submitted_by");--> statement-breakpoint
CREATE INDEX "daily_reports_date_location_idx" ON "daily_reports" USING btree ("report_date","location");--> statement-breakpoint
CREATE INDEX "daily_reports_status_idx" ON "daily_reports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_trucks_plate_idx" ON "fleet_trucks" USING btree ("plate_number");--> statement-breakpoint
CREATE INDEX "fleet_trucks_active_idx" ON "fleet_trucks" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "fleet_trips_truck_date_idx" ON "fleet_trips" USING btree ("fleet_truck_id","trip_date");--> statement-breakpoint
CREATE INDEX "incident_records_type_idx" ON "incident_records" USING btree ("incident_type");--> statement-breakpoint
CREATE INDEX "incident_records_status_idx" ON "incident_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incident_records_created_idx" ON "incident_records" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_owner_idx" ON "ledger_accounts" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_created_idx" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_date_idx" ON "ledger_entries" USING btree ("account_id","entry_date");--> statement-breakpoint
CREATE INDEX "ledger_entries_category_idx" ON "ledger_entries" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_reference_idx" ON "ledger_entries" USING btree ("reference") WHERE "ledger_entries"."reference" IS NOT NULL AND "ledger_entries"."reference" != '';--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_number_idx" ON "offline_sales" USING btree ("sale_number");--> statement-breakpoint
CREATE INDEX "offline_sales_status_idx" ON "offline_sales" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offline_sales_created_idx" ON "offline_sales" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sale_items_sale_product_idx" ON "offline_sale_items" USING btree ("offline_sale_id","product_id");