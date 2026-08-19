CREATE TYPE "sman"."delivery_customer_type" AS ENUM('customer', 'filling_station');--> statement-breakpoint
CREATE TYPE "sman"."delivery_note_status" AS ENUM('Pending', 'In Transit', 'Delivered', 'Cancelled');--> statement-breakpoint
CREATE TABLE "sman"."customer_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"order_id" bigint,
	"payment_record_id" bigint,
	"description" varchar(255) DEFAULT '',
	"reference" varchar(255) DEFAULT '',
	"notes" text DEFAULT '',
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "sman"."principal_type" NOT NULL,
	"staff_id" bigint,
	"customer_id" bigint,
	"refresh_token_hash" char(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"replaced_by_id" bigint,
	"revoked_reason" varchar(32),
	"device_name" varchar(255) DEFAULT '',
	"user_agent" text,
	"ip_address" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_principal_arc_check" CHECK (("sman"."sessions"."principal_type" = 'staff'    AND "sman"."sessions"."staff_id"    IS NOT NULL AND "sman"."sessions"."customer_id" IS NULL)
       OR ("sman"."sessions"."principal_type" = 'customer' AND "sman"."sessions"."customer_id" IS NOT NULL AND "sman"."sessions"."staff_id"    IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sman"."delivery_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_note_number" varchar(50) NOT NULL,
	"customer_id" bigint NOT NULL,
	"customer_type_snapshot" "sman"."delivery_customer_type" NOT NULL,
	"order_id" bigint,
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
	"status" "sman"."delivery_note_status" DEFAULT 'Pending' NOT NULL,
	"remarks" text DEFAULT '',
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_notes_qty_check" CHECK ("sman"."delivery_notes"."quantity_delivered" > 0)
);
--> statement-breakpoint
CREATE TABLE "sman"."depot_extras" (
	"depot_id" bigint PRIMARY KEY NOT NULL,
	"code" varchar(50),
	"address" text DEFAULT '',
	"city" varchar(100) DEFAULT '',
	"state" varchar(100) DEFAULT '',
	"country" varchar(100) DEFAULT '',
	"postcode" varchar(20) DEFAULT '',
	"parked_trucks_count" integer DEFAULT 0 NOT NULL,
	"max_capacity" integer,
	"status" varchar(20) DEFAULT 'Active' NOT NULL,
	"established_year" varchar(10) DEFAULT '',
	"paystack_subaccount_code" varchar(100) DEFAULT '',
	"subaccount_active" boolean DEFAULT false NOT NULL,
	"subaccount_split_percentage" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depot_extras_parked_trucks_check" CHECK ("sman"."depot_extras"."parked_trucks_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sman"."lpg_order_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" varchar(50) NOT NULL,
	"customer_id" bigint NOT NULL,
	"company_name" varchar(255) DEFAULT '',
	"lpg_station_id" bigint,
	"cylinder_size_kg" integer NOT NULL,
	"cylinder_quantity" integer NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_state" varchar(100) DEFAULT '',
	"delivery_lga" varchar(100) DEFAULT '',
	"status" varchar(30) DEFAULT 'Pending Review' NOT NULL,
	"payment_status" varchar(20) DEFAULT 'Unpaid' NOT NULL,
	"collection_status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"price_per_kg" numeric(15, 2),
	"delivery_price" numeric(15, 2),
	"total_amount" numeric(15, 2),
	"expected_arrival_date" varchar(20),
	"payment_reference" varchar(100),
	"payment_mode" varchar(50),
	"virtual_account_number" varchar(30) DEFAULT '',
	"virtual_account_bank" varchar(100) DEFAULT '',
	"virtual_account_name" varchar(255) DEFAULT '',
	"reviewed_by" bigint,
	"reviewed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sman"."customer_credits" ADD CONSTRAINT "customer_credits_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_credits" ADD CONSTRAINT "customer_credits_order_id_consumer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."consumer_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_credits" ADD CONSTRAINT "customer_credits_payment_record_id_consumer_orderpaymentrecord_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."consumer_orderpaymentrecord"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_credits" ADD CONSTRAINT "customer_credits_created_by_administration_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."sessions" ADD CONSTRAINT "sessions_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."sessions" ADD CONSTRAINT "sessions_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_administration_deliverycustomer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."administration_deliverycustomer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."delivery_notes" ADD CONSTRAINT "delivery_notes_order_id_consumer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."consumer_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."delivery_notes" ADD CONSTRAINT "delivery_notes_created_by_administration_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_extras" ADD CONSTRAINT "depot_extras_depot_id_consumer_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."consumer_depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."lpg_order_requests" ADD CONSTRAINT "lpg_order_requests_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."lpg_order_requests" ADD CONSTRAINT "lpg_order_requests_lpg_station_id_consumer_lpgplant_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."consumer_lpgplant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."lpg_order_requests" ADD CONSTRAINT "lpg_order_requests_reviewed_by_administration_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_credits_customer_idx" ON "sman"."customer_credits" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_credits_order_idx" ON "sman"."customer_credits" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_idx" ON "sman"."sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_staff_idx" ON "sman"."sessions" USING btree ("staff_id","created_at") WHERE "sman"."sessions"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_customer_idx" ON "sman"."sessions" USING btree ("customer_id","created_at") WHERE "sman"."sessions"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sman"."sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sman"."sessions" USING btree ("expires_at") WHERE "sman"."sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_notes_number_idx" ON "sman"."delivery_notes" USING btree ("delivery_note_number");--> statement-breakpoint
CREATE INDEX "delivery_notes_customer_idx" ON "sman"."delivery_notes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "delivery_notes_status_idx" ON "sman"."delivery_notes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lpg_requests_status_idx" ON "sman"."lpg_order_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lpg_requests_customer_idx" ON "sman"."lpg_order_requests" USING btree ("customer_id");