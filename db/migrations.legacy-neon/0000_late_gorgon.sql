CREATE TYPE "public"."customer_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('Active', 'On Trip', 'Off Duty');--> statement-breakpoint
CREATE TYPE "public"."truck_status" AS ENUM('In Transit', 'Idle', 'Maintenance');--> statement-breakpoint
CREATE TYPE "public"."depot_status" AS ENUM('Active', 'Maintenance', 'High Capacity');--> statement-breakpoint
CREATE TYPE "public"."order_delivery_type" AS ENUM('delivery', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('Unpaid', 'Paid');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('Pending', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."pfi_status" AS ENUM('active', 'finished');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('Active', 'Redeemed');--> statement-breakpoint
CREATE TYPE "public"."deposit_type" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."delivery_customer_type" AS ENUM('customer', 'filling_station');--> statement-breakpoint
CREATE TYPE "public"."delivery_customer_status" AS ENUM('active', 'dormant', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."delivery_note_status" AS ENUM('Pending', 'In Transit', 'Delivered', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."loading_status" AS ENUM('loaded', 'offloaded', 'empty');--> statement-breakpoint
CREATE TYPE "public"."deposit_status_enum" AS ENUM('pending', 'paid', 'partial');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('manual', 'paystack_dva');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) DEFAULT '',
	"phone" varchar(30) NOT NULL,
	"company_name" varchar(255) DEFAULT '',
	"address" text DEFAULT '',
	"status" "customer_status" DEFAULT 'Active' NOT NULL,
	"balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"deposit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"previous_deposit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"paystack_customer_id" varchar(100) DEFAULT '',
	"virtual_account_number" varchar(30) DEFAULT '',
	"virtual_account_bank" varchar(100) DEFAULT '',
	"virtual_account_name" varchar(255) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_type" "delivery_customer_type" NOT NULL,
	"customer_code" varchar(50),
	"name" varchar(255) NOT NULL,
	"phone_number" varchar(30) NOT NULL,
	"alt_phone_number" varchar(30) DEFAULT '',
	"email" varchar(255) DEFAULT '',
	"home_address" text DEFAULT '',
	"office_address" text DEFAULT '',
	"passport_photo" text DEFAULT '',
	"contact_person" varchar(255) DEFAULT '',
	"contact_person_phone" varchar(30) DEFAULT '',
	"station_address" text DEFAULT '',
	"tank_capacity" integer DEFAULT 0,
	"pump_count" integer DEFAULT 1,
	"bank_details" jsonb DEFAULT '{}'::jsonb,
	"paystack_customer_id" varchar(100) DEFAULT '',
	"virtual_account_number" varchar(30) DEFAULT '',
	"virtual_account_bank" varchar(100) DEFAULT '',
	"virtual_account_name" varchar(255) DEFAULT '',
	"credit_limit" numeric(15, 2) DEFAULT '0',
	"status" "delivery_customer_status" DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '',
	"last_transaction_date" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer,
	"truck_number" varchar(30) DEFAULT '',
	"pfi_id" integer,
	"pfi_number" varchar(100) DEFAULT '',
	"pfi_product" varchar(255) DEFAULT '',
	"depot" varchar(255) DEFAULT '',
	"customer_id" integer,
	"customer_name" varchar(255) DEFAULT '',
	"quantity_allocated" real DEFAULT 0,
	"rate" numeric(15, 2) DEFAULT '0',
	"date_allocated" varchar(20) DEFAULT '',
	"date_offloaded" varchar(20),
	"loading_status" "loading_status" DEFAULT 'loaded' NOT NULL,
	"location" varchar(255) DEFAULT '',
	"pfi_location" varchar(255) DEFAULT '',
	"allocation_code" varchar(100),
	"collection_accounts" jsonb DEFAULT '[]'::jsonb,
	"remittance_accounts" jsonb DEFAULT '[]'::jsonb,
	"notes" text DEFAULT '',
	"created_by" varchar(255) DEFAULT '',
	"offloaded_by" varchar(255) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_note_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"customer_type_snapshot" "delivery_customer_type" NOT NULL,
	"order_id" integer,
	"delivery_address" text NOT NULL,
	"contact_person_on_site" jsonb DEFAULT '{}'::jsonb,
	"product" varchar(255) NOT NULL,
	"quantity_delivered" real NOT NULL,
	"unit" varchar(30) DEFAULT 'Liters',
	"driver" jsonb DEFAULT '{}'::jsonb,
	"truck" jsonb DEFAULT '{}'::jsonb,
	"depot_of_loading" varchar(255) DEFAULT '',
	"dispatch_date" timestamp with time zone DEFAULT now(),
	"expected_delivery_date" timestamp with time zone,
	"status" "delivery_note_status" DEFAULT 'Pending' NOT NULL,
	"remarks" text DEFAULT '',
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_notes_qty_check" CHECK ("delivery_notes"."quantity_delivered" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_number" varchar(30) DEFAULT '',
	"date_loaded" varchar(20) DEFAULT '',
	"depot_loaded" varchar(255) DEFAULT '',
	"customer_id" integer,
	"customer_name" varchar(255) DEFAULT '',
	"location" varchar(255) DEFAULT '',
	"quantity" real DEFAULT 0,
	"rate" numeric(15, 2) DEFAULT '0',
	"sales_value" numeric(15, 2) DEFAULT '0',
	"payment_amount" numeric(15, 2) DEFAULT '0',
	"expenses_amount" numeric(15, 2) DEFAULT '0',
	"balance" numeric(15, 2) DEFAULT '0',
	"payer_name" varchar(255) DEFAULT '',
	"bank" varchar(255) DEFAULT '',
	"date_of_payment" varchar(20),
	"deposit_status" "deposit_status_enum" DEFAULT 'pending' NOT NULL,
	"phone_number" varchar(30) DEFAULT '',
	"remarks" text DEFAULT '',
	"entered_by" varchar(255) DEFAULT '',
	"allocation_code" varchar(100),
	"collection_accounts" jsonb DEFAULT '[]'::jsonb,
	"remittance_accounts" jsonb DEFAULT '[]'::jsonb,
	"payment_method" "payment_method" DEFAULT 'manual' NOT NULL,
	"paystack_reference" varchar(255),
	"paystack_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"type" "deposit_type" NOT NULL,
	"description" text DEFAULT '',
	"reference" varchar(255) DEFAULT '',
	"recorded_by" integer,
	"balance_after" numeric(15, 2) DEFAULT '0',
	"paystack_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_amount_check" CHECK ("deposits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"address" text NOT NULL,
	"city" varchar(100) NOT NULL,
	"state" varchar(100) NOT NULL,
	"country" varchar(100) NOT NULL,
	"postcode" varchar(20) NOT NULL,
	"parked_trucks_count" integer DEFAULT 0 NOT NULL,
	"max_capacity" integer NOT NULL,
	"status" "depot_status" DEFAULT 'Active' NOT NULL,
	"established_year" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depots_max_capacity_check" CHECK ("depots"."max_capacity" >= 1),
	CONSTRAINT "depots_parked_trucks_check" CHECK ("depots"."parked_trucks_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "depot_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_product_price_id" integer NOT NULL,
	"price" numeric(15, 2) NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depot_product_capacities" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depot_product_cap_check" CHECK ("depot_product_capacities"."capacity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "depot_product_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"current_price" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depot_product_price_check" CHECK ("depot_product_prices"."current_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "depot_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) DEFAULT '',
	"phone" varchar(30) NOT NULL,
	"license_number" varchar(100) NOT NULL,
	"license_class" varchar(50) NOT NULL,
	"rating" real DEFAULT 0,
	"status" "driver_status" DEFAULT 'Active' NOT NULL,
	"assigned_truck_ref" integer,
	"safety_score" integer DEFAULT 0,
	"license_expiry" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_rating_check" CHECK ("drivers"."rating" >= 0 AND "drivers"."rating" <= 5),
	CONSTRAINT "drivers_safety_score_check" CHECK ("drivers"."safety_score" >= 0 AND "drivers"."safety_score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "driver_truck_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"truck_id" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"surname" varchar(100) NOT NULL,
	"other_names" varchar(200) DEFAULT '',
	"email" varchar(255) NOT NULL,
	"phone_number" varchar(30),
	"password" text,
	"is_password_set" boolean DEFAULT false NOT NULL,
	"password_reset_token" text,
	"password_reset_expires" timestamp with time zone,
	"roles" text[] DEFAULT ARRAY['admin']::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"profile_picture_url" text,
	"profile_picture_public_id" text,
	"refresh_token" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" serial PRIMARY KEY NOT NULL,
	"plate_number" varchar(30) NOT NULL,
	"model" varchar(100) NOT NULL,
	"capacity" varchar(50) NOT NULL,
	"status" "truck_status" DEFAULT 'Idle' NOT NULL,
	"driver_ref" integer,
	"fuel_level" integer DEFAULT 100,
	"mileage" varchar(50) DEFAULT '0 km',
	"vin" varchar(50),
	"year" integer,
	"make" varchar(100),
	"type" varchar(100),
	"insurance_expiry" timestamp with time zone,
	"registration_expiry" timestamp with time zone,
	"next_service_mileage" integer DEFAULT 15000,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trucks_fuel_level_check" CHECK ("trucks"."fuel_level" >= 0 AND "trucks"."fuel_level" <= 100)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"sku" varchar(50) NOT NULL,
	"category" varchar(100) NOT NULL,
	"grade_class" varchar(100) DEFAULT '',
	"description" text DEFAULT '',
	"density" varchar(50) DEFAULT '',
	"flash_point" varchar(50) DEFAULT '',
	"un_number" varchar(50) DEFAULT '',
	"hazard_class" varchar(50) DEFAULT 'None',
	"stock_level" integer DEFAULT 0,
	"unit" varchar(30) DEFAULT 'Liters',
	"supplier" varchar(255) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pfis" (
	"id" serial PRIMARY KEY NOT NULL,
	"pfi_number" varchar(100) NOT NULL,
	"status" "pfi_status" DEFAULT 'active' NOT NULL,
	"description" text DEFAULT '',
	"pfi_date" timestamp with time zone,
	"location_id" integer,
	"location_name" varchar(255) DEFAULT '',
	"product_id" integer,
	"product_name" varchar(255) DEFAULT '',
	"product_unit" varchar(30) DEFAULT 'Litres',
	"starting_qty_litres" integer DEFAULT 0 NOT NULL,
	"qty_volume_mt" real DEFAULT 0,
	"sold_qty_litres" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0',
	"unit_price" numeric(15, 2) DEFAULT '0',
	"audit_officer_id" integer,
	"audit_officer_name" varchar(255) DEFAULT '',
	"product_officer_id" integer,
	"product_officer_name" varchar(255) DEFAULT '',
	"it_compliance_officer_id" integer,
	"it_compliance_officer_name" varchar(255) DEFAULT '',
	"security_exit_officer_id" integer,
	"security_exit_officer_name" varchar(255) DEFAULT '',
	"commission_officer_id" integer,
	"commission_officer_name" varchar(255) DEFAULT '',
	"sales_manager_id" integer,
	"sales_manager_name" varchar(255) DEFAULT '',
	"vessel_broker" varchar(255) DEFAULT '',
	"vessel_name" varchar(255) DEFAULT '',
	"surveyor_name" varchar(255) DEFAULT '',
	"surveyor_phone" varchar(30) DEFAULT '',
	"closure_date" timestamp with time zone,
	"total_inflow" numeric(15, 2) DEFAULT '0',
	"closure_bank" varchar(255) DEFAULT '',
	"purchase_cost" numeric(15, 2) DEFAULT '0',
	"aggregate_expenses" numeric(15, 2) DEFAULT '0',
	"closure_handler" varchar(255) DEFAULT '',
	"closure_remarks" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pfis_qty_check" CHECK ("pfis"."starting_qty_litres" >= 0),
	CONSTRAINT "pfis_sold_qty_check" CHECK ("pfis"."sold_qty_litres" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"state" varchar(100) NOT NULL,
	"depot_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"delivery_type" "order_delivery_type" NOT NULL,
	"pfi_id" integer,
	"virtual_account_number" varchar(30) DEFAULT '',
	"virtual_account_bank" varchar(100) DEFAULT '',
	"virtual_account_name" varchar(255) DEFAULT '',
	"payment_status" "order_payment_status" DEFAULT 'Unpaid' NOT NULL,
	"status" "order_status" DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_quantity_check" CHECK ("orders"."quantity" > 0),
	CONSTRAINT "orders_price_check" CHECK ("orders"."price" >= 0),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" varchar(50) NOT NULL,
	"order_id" integer NOT NULL,
	"status" "ticket_status" DEFAULT 'Active' NOT NULL,
	"qr_code_data_url" text NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_status" DEFAULT 'pending' NOT NULL,
	"error" text DEFAULT '',
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_customers" ADD CONSTRAINT "delivery_customers_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD CONSTRAINT "delivery_inventory_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD CONSTRAINT "delivery_inventory_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD CONSTRAINT "delivery_inventory_customer_id_delivery_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."delivery_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_delivery_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."delivery_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_sales" ADD CONSTRAINT "delivery_sales_customer_id_delivery_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."delivery_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_price_history" ADD CONSTRAINT "depot_price_history_depot_product_price_id_depot_product_prices_id_fk" FOREIGN KEY ("depot_product_price_id") REFERENCES "public"."depot_product_prices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_product_capacities" ADD CONSTRAINT "depot_product_capacities_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_product_capacities" ADD CONSTRAINT "depot_product_capacities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_product_prices" ADD CONSTRAINT "depot_product_prices_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_product_prices" ADD CONSTRAINT "depot_product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_staff" ADD CONSTRAINT "depot_staff_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_staff" ADD CONSTRAINT "depot_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_truck_history" ADD CONSTRAINT "driver_truck_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_truck_history" ADD CONSTRAINT "driver_truck_history_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_location_id_depots_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_audit_officer_id_staff_id_fk" FOREIGN KEY ("audit_officer_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_product_officer_id_staff_id_fk" FOREIGN KEY ("product_officer_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_it_compliance_officer_id_staff_id_fk" FOREIGN KEY ("it_compliance_officer_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_security_exit_officer_id_staff_id_fk" FOREIGN KEY ("security_exit_officer_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_commission_officer_id_staff_id_fk" FOREIGN KEY ("commission_officer_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_sales_manager_id_staff_id_fk" FOREIGN KEY ("sales_manager_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_redeemed_by_staff_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_virtual_account_idx" ON "customers" USING btree ("virtual_account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_customers_code_idx" ON "delivery_customers" USING btree ("customer_code");--> statement-breakpoint
CREATE INDEX "delivery_customers_type_idx" ON "delivery_customers" USING btree ("customer_type");--> statement-breakpoint
CREATE INDEX "delivery_customers_status_idx" ON "delivery_customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "delivery_customers_virtual_account_idx" ON "delivery_customers" USING btree ("virtual_account_number");--> statement-breakpoint
CREATE INDEX "delivery_inventory_truck_idx" ON "delivery_inventory" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "delivery_inventory_pfi_idx" ON "delivery_inventory" USING btree ("pfi_id");--> statement-breakpoint
CREATE INDEX "delivery_inventory_customer_idx" ON "delivery_inventory" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "delivery_inventory_status_idx" ON "delivery_inventory" USING btree ("loading_status");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_notes_number_idx" ON "delivery_notes" USING btree ("delivery_note_number");--> statement-breakpoint
CREATE INDEX "delivery_notes_customer_idx" ON "delivery_notes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "delivery_notes_status_idx" ON "delivery_notes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "delivery_sales_customer_idx" ON "delivery_sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "delivery_sales_truck_idx" ON "delivery_sales" USING btree ("truck_number");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_sales_paystack_ref_unique_idx" ON "delivery_sales" USING btree ("paystack_reference") WHERE "delivery_sales"."paystack_reference" IS NOT NULL AND "delivery_sales"."paystack_reference" != '';--> statement-breakpoint
CREATE INDEX "deposits_customer_created_idx" ON "deposits" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_reference_unique_idx" ON "deposits" USING btree ("reference") WHERE "deposits"."reference" IS NOT NULL AND "deposits"."reference" != '';--> statement-breakpoint
CREATE UNIQUE INDEX "depots_code_idx" ON "depots" USING btree ("code");--> statement-breakpoint
CREATE INDEX "depot_price_history_parent_idx" ON "depot_price_history" USING btree ("depot_product_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depot_product_cap_unique_idx" ON "depot_product_capacities" USING btree ("depot_id","product_id");--> statement-breakpoint
CREATE INDEX "depot_product_cap_depot_idx" ON "depot_product_capacities" USING btree ("depot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depot_product_price_unique_idx" ON "depot_product_prices" USING btree ("depot_id","product_id");--> statement-breakpoint
CREATE INDEX "depot_product_price_depot_idx" ON "depot_product_prices" USING btree ("depot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depot_staff_unique_idx" ON "depot_staff" USING btree ("depot_id","staff_id");--> statement-breakpoint
CREATE INDEX "depot_staff_depot_idx" ON "depot_staff" USING btree ("depot_id");--> statement-breakpoint
CREATE INDEX "depot_staff_staff_idx" ON "depot_staff" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_license_number_idx" ON "drivers" USING btree ("license_number");--> statement-breakpoint
CREATE INDEX "drivers_status_idx" ON "drivers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drivers_truck_idx" ON "drivers" USING btree ("assigned_truck_ref");--> statement-breakpoint
CREATE INDEX "driver_truck_history_driver_idx" ON "driver_truck_history" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_truck_history_truck_idx" ON "driver_truck_history" USING btree ("truck_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_idx" ON "staff" USING btree ("email");--> statement-breakpoint
CREATE INDEX "staff_refresh_token_idx" ON "staff" USING btree ("refresh_token");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_plate_number_idx" ON "trucks" USING btree ("plate_number");--> statement-breakpoint
CREATE INDEX "trucks_status_idx" ON "trucks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trucks_driver_idx" ON "trucks" USING btree ("driver_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "pfis_pfi_number_idx" ON "pfis" USING btree ("pfi_number");--> statement-breakpoint
CREATE INDEX "pfis_location_product_status_idx" ON "pfis" USING btree ("location_id","product_id","status");--> statement-breakpoint
CREATE INDEX "pfis_status_idx" ON "pfis" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_customer_payment_created_idx" ON "orders" USING btree ("customer_id","payment_status","created_at");--> statement-breakpoint
CREATE INDEX "orders_virtual_account_payment_idx" ON "orders" USING btree ("virtual_account_number","payment_status");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_ticket_number_idx" ON "tickets" USING btree ("ticket_number");--> statement-breakpoint
CREATE INDEX "tickets_order_idx" ON "tickets" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_events_status_created_idx" ON "webhook_events" USING btree ("status","created_at");