CREATE TYPE "public"."wallet_hold_status" AS ENUM('active', 'converted', 'released');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('staff', 'customer', 'system');--> statement-breakpoint
CREATE TYPE "public"."fleet_entry_type" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."customer_identity_provider" AS ENUM('email', 'google', 'apple', 'pin');--> statement-breakpoint
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
CREATE TABLE "customer_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"provider" "customer_identity_provider" NOT NULL,
	"provider_user_id" varchar(320) NOT NULL,
	"secret_hash" text,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"device_name" varchar(255) DEFAULT '',
	"user_agent" varchar(512) DEFAULT '',
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_passkeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"credential_id" varchar(512) NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"device_name" varchar(255) DEFAULT '',
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"purpose" varchar(20) NOT NULL,
	"challenge" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
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
CREATE TABLE "fleet_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"entry_type" "fleet_entry_type" NOT NULL,
	"category" varchar(100) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"entry_date" date NOT NULL,
	"description" text DEFAULT '',
	"entered_by" varchar(255) DEFAULT '',
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_ledger_amount_check" CHECK ("fleet_ledger_entries"."amount" > 0)
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
CREATE TABLE "wallet_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" "wallet_hold_status" DEFAULT 'active' NOT NULL,
	"description" text DEFAULT '',
	"deposit_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "wallet_holds_amount_check" CHECK ("wallet_holds"."amount" > 0)
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
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_trusted_devices" ADD CONSTRAINT "customer_trusted_devices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_passkeys" ADD CONSTRAINT "customer_passkeys_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submitted_by_staff_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_ledger_entries" ADD CONSTRAINT "fleet_ledger_entries_truck_id_fleet_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."fleet_trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_ledger_entries" ADD CONSTRAINT "fleet_ledger_entries_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD CONSTRAINT "fleet_trucks_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_records" ADD CONSTRAINT "incident_records_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_records" ADD CONSTRAINT "incident_records_submitted_by_staff_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_records" ADD CONSTRAINT "incident_records_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_reconciled_by_staff_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_items" ADD CONSTRAINT "offline_sale_items_offline_sale_id_offline_sales_id_fk" FOREIGN KEY ("offline_sale_id") REFERENCES "public"."offline_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_items" ADD CONSTRAINT "offline_sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_provider_uid_idx" ON "customer_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_customer_provider_idx" ON "customer_identities" USING btree ("customer_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_trusted_devices_token_idx" ON "customer_trusted_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_trusted_devices_customer_idx" ON "customer_trusted_devices" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_passkeys_credential_idx" ON "customer_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "customer_passkeys_customer_idx" ON "customer_passkeys" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_challenges_challenge_idx" ON "webauthn_challenges" USING btree ("challenge");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expires_idx" ON "webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_unique_idx" ON "daily_reports" USING btree ("report_date","location","pfi_number","submitted_by");--> statement-breakpoint
CREATE INDEX "daily_reports_date_location_idx" ON "daily_reports" USING btree ("report_date","location");--> statement-breakpoint
CREATE INDEX "daily_reports_status_idx" ON "daily_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fleet_ledger_truck_date_idx" ON "fleet_ledger_entries" USING btree ("truck_id","entry_date");--> statement-breakpoint
CREATE INDEX "fleet_ledger_category_idx" ON "fleet_ledger_entries" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_trucks_plate_idx" ON "fleet_trucks" USING btree ("plate_number");--> statement-breakpoint
CREATE INDEX "fleet_trucks_active_idx" ON "fleet_trucks" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "incident_records_type_idx" ON "incident_records" USING btree ("incident_type");--> statement-breakpoint
CREATE INDEX "incident_records_status_idx" ON "incident_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incident_records_created_idx" ON "incident_records" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_holds_order_idx" ON "wallet_holds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "wallet_holds_customer_status_idx" ON "wallet_holds" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_number_idx" ON "offline_sales" USING btree ("sale_number");--> statement-breakpoint
CREATE INDEX "offline_sales_status_idx" ON "offline_sales" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offline_sales_created_idx" ON "offline_sales" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sale_items_sale_product_idx" ON "offline_sale_items" USING btree ("offline_sale_id","product_id");