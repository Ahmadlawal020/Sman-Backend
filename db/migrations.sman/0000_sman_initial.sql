CREATE SCHEMA "sman";
--> statement-breakpoint
CREATE TYPE "sman"."driver_status" AS ENUM('Active', 'On Trip', 'Off Duty');--> statement-breakpoint
CREATE TYPE "sman"."wallet_hold_status" AS ENUM('active', 'converted', 'released');--> statement-breakpoint
CREATE TYPE "sman"."webhook_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "sman"."customer_identity_provider" AS ENUM('email', 'google', 'apple', 'pin');--> statement-breakpoint
CREATE TYPE "sman"."license_verification_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "sman"."commission_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "sman"."principal_type" AS ENUM('staff', 'customer');--> statement-breakpoint
CREATE TYPE "sman"."device_token_platform" AS ENUM('android', 'ios', 'web');--> statement-breakpoint
CREATE TYPE "sman"."notification_category" AS ENUM('orders', 'payments', 'delivery', 'tickets', 'account', 'security', 'reports', 'operations', 'marketing', 'system');--> statement-breakpoint
CREATE TYPE "sman"."notification_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "sman"."notification_channel" AS ENUM('in_app', 'push', 'email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "sman"."notification_delivery_status" AS ENUM('pending', 'sent', 'delivered', 'failed', 'skipped', 'suppressed');--> statement-breakpoint
CREATE TYPE "sman"."wa_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "sman"."wa_message_status" AS ENUM('received', 'processed', 'queued', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "sman"."wa_session_state" AS ENUM('IDENTIFY', 'MENU', 'DEPOT', 'PRODUCT', 'QUANTITY', 'COMPANY', 'COLLECT', 'LOGISTICS', 'CONFIRM', 'AWAIT_PAYMENT');--> statement-breakpoint
CREATE TYPE "sman"."wa_template_status" AS ENUM('pending', 'approved', 'rejected', 'paused');--> statement-breakpoint
CREATE TABLE "sman"."customer_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"provider" "sman"."customer_identity_provider" NOT NULL,
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
CREATE TABLE "sman"."customer_trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"device_name" varchar(255) DEFAULT '',
	"user_agent" varchar(512) DEFAULT '',
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."customer_passkeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"credential_id" varchar(512) NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"device_name" varchar(255) DEFAULT '',
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."webauthn_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint,
	"purpose" varchar(20) NOT NULL,
	"challenge" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."customer_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"purpose" varchar(32) DEFAULT 'auth' NOT NULL,
	"code_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"request_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) DEFAULT '',
	"phone" varchar(30) NOT NULL,
	"license_number" varchar(100) NOT NULL,
	"license_class" varchar(50) NOT NULL,
	"rating" real DEFAULT 0,
	"status" "sman"."driver_status" DEFAULT 'Active' NOT NULL,
	"assigned_truck_ref" integer,
	"safety_score" integer DEFAULT 0,
	"license_expiry" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_rating_check" CHECK ("sman"."drivers"."rating" >= 0 AND "sman"."drivers"."rating" <= 5),
	CONSTRAINT "drivers_safety_score_check" CHECK ("sman"."drivers"."safety_score" >= 0 AND "sman"."drivers"."safety_score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "sman"."driver_truck_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"truck_id" bigint NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."depot_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_id" bigint NOT NULL,
	"staff_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."depot_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_product_price_id" bigint NOT NULL,
	"price" numeric(15, 2) NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."depot_product_capacities" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depot_product_cap_check" CHECK ("sman"."depot_product_capacities"."capacity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sman"."depot_product_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"commission_rate" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depot_product_commission_rate_check" CHECK ("sman"."depot_product_commissions"."commission_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sman"."wallet_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"order_id" bigint NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" "sman"."wallet_hold_status" DEFAULT 'active' NOT NULL,
	"description" text DEFAULT '',
	"deposit_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "wallet_holds_amount_check" CHECK ("sman"."wallet_holds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "sman"."webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "sman"."webhook_status" DEFAULT 'pending' NOT NULL,
	"error" text DEFAULT '',
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."expected_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"order_id" bigint,
	"depot_id" bigint,
	"pfi_id" bigint,
	"expected_amount" numeric(15, 2),
	"reference" varchar(255) DEFAULT '',
	"note" text DEFAULT '',
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"matched_deposit_id" bigint,
	"created_by" bigint,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."order_deposit_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"deposit_id" bigint NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"depot_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"commission_rate" numeric(15, 2) NOT NULL,
	"commission_amount" numeric(15, 2) NOT NULL,
	"status" "sman"."commission_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commissions_quantity_check" CHECK ("sman"."commissions"."quantity" > 0),
	CONSTRAINT "commissions_rate_check" CHECK ("sman"."commissions"."commission_rate" >= 0),
	CONSTRAINT "commissions_amount_check" CHECK ("sman"."commissions"."commission_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sman"."vendors" (
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
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."pfi_expense_extras" (
	"expense_id" bigint PRIMARY KEY NOT NULL,
	"vendor_id" bigint,
	"tin_number" varchar(30) DEFAULT '',
	"invoice_number" varchar(100) DEFAULT '',
	"amount_ex_vat" numeric(15, 2),
	"vat_amount" numeric(15, 2),
	"invoice_amount" numeric(15, 2),
	"wht_deduction" numeric(15, 2),
	"wht_rate" numeric(5, 2),
	"bank_code" varchar(20) DEFAULT '',
	"payment_reference" varchar(100) DEFAULT '',
	"payment_date" timestamp with time zone,
	"payment_method" varchar(30) DEFAULT '',
	"payment_notes" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."pfi_expense_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" bigint NOT NULL,
	"body" text NOT NULL,
	"author_id" bigint,
	"author_name" varchar(255) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."expense_category_extras" (
	"category_id" bigint PRIMARY KEY NOT NULL,
	"gl_code" varchar(20),
	"gl_group" varchar(40),
	"gl_subgroup" varchar(60) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."bank_account_extras" (
	"bank_account_id" bigint PRIMARY KEY NOT NULL,
	"bank_code" varchar(50) DEFAULT '',
	"branch_name" varchar(150) DEFAULT '',
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"depot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lpg_station_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."lpg_station_cylinders" (
	"id" serial PRIMARY KEY NOT NULL,
	"lpg_station_id" bigint NOT NULL,
	"cylinder_size_kg" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lpg_station_cylinders_size_check" CHECK ("sman"."lpg_station_cylinders"."cylinder_size_kg" >= 1),
	CONSTRAINT "lpg_station_cylinders_qty_check" CHECK ("sman"."lpg_station_cylinders"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sman"."lpg_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lpg_station_id" bigint NOT NULL,
	"price_per_kg" numeric(15, 2) NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."lpg_station_extras" (
	"lpg_station_id" bigint PRIMARY KEY NOT NULL,
	"address" text DEFAULT '',
	"city" varchar(100) DEFAULT '',
	"state" varchar(100) DEFAULT '',
	"country" varchar(100) DEFAULT '',
	"postcode" varchar(20) DEFAULT '',
	"established_year" varchar(10) DEFAULT '',
	"paystack_subaccount_code" varchar(100) DEFAULT '',
	"subaccount_active" boolean DEFAULT false NOT NULL,
	"subaccount_split_percentage" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."customer_licenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"license_url" text DEFAULT '',
	"license_public_id" text DEFAULT '',
	"expiry_date" date,
	"status" "sman"."license_verification_status" DEFAULT 'pending' NOT NULL,
	"verified_by" bigint,
	"verified_by_name" varchar(255) DEFAULT '',
	"verified_at" timestamp with time zone,
	"verification_comment" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."dangote_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"sku" varchar(50) NOT NULL,
	"category" varchar(100) NOT NULL,
	"unit" varchar(30) DEFAULT 'Tons' NOT NULL,
	"description" text DEFAULT '',
	"plants" text DEFAULT '[]' NOT NULL,
	"status" varchar(20) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."dangote_order_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" varchar(50) NOT NULL,
	"customer_id" bigint NOT NULL,
	"company_name" varchar(255) DEFAULT '',
	"license_id" bigint,
	"product" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_unit" varchar(20) DEFAULT 'Tons' NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_state" varchar(100) DEFAULT '',
	"delivery_lga" varchar(100) DEFAULT '',
	"status" varchar(30) DEFAULT 'Pending Review' NOT NULL,
	"payment_status" varchar(20) DEFAULT 'Unpaid' NOT NULL,
	"collection_status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"price_per_unit" numeric(15, 2),
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
CREATE TABLE "sman"."staff_page_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" bigint NOT NULL,
	"route_path" varchar(100) NOT NULL,
	"allowed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."staff_password_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" bigint NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."device_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "sman"."principal_type" NOT NULL,
	"staff_id" bigint,
	"customer_id" bigint,
	"token" text NOT NULL,
	"provider" varchar(16) DEFAULT 'fcm' NOT NULL,
	"platform" "sman"."device_token_platform" NOT NULL,
	"device_id" varchar(128) DEFAULT '' NOT NULL,
	"device_name" varchar(255) DEFAULT '' NOT NULL,
	"app_version" varchar(32) DEFAULT '' NOT NULL,
	"locale" varchar(16) DEFAULT '' NOT NULL,
	"timezone" varchar(64) DEFAULT '' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_principal_arc_check" CHECK (("sman"."device_tokens"."principal_type" = 'staff'    AND "sman"."device_tokens"."staff_id"    IS NOT NULL AND "sman"."device_tokens"."customer_id" IS NULL)
       OR ("sman"."device_tokens"."principal_type" = 'customer' AND "sman"."device_tokens"."customer_id" IS NOT NULL AND "sman"."device_tokens"."staff_id"    IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sman"."notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_type" "sman"."principal_type" NOT NULL,
	"staff_id" bigint,
	"customer_id" bigint,
	"type" varchar(64) NOT NULL,
	"category" "sman"."notification_category" NOT NULL,
	"priority" "sman"."notification_priority" DEFAULT 'normal' NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" varchar(64) DEFAULT '' NOT NULL,
	"entity_id" varchar(64) DEFAULT '' NOT NULL,
	"action_url" text,
	"image_url" text,
	"dedupe_key" varchar(160),
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_recipient_arc_check" CHECK (("sman"."notifications"."recipient_type" = 'staff'    AND "sman"."notifications"."staff_id"    IS NOT NULL AND "sman"."notifications"."customer_id" IS NULL)
       OR ("sman"."notifications"."recipient_type" = 'customer' AND "sman"."notifications"."customer_id" IS NOT NULL AND "sman"."notifications"."staff_id"    IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sman"."notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" bigint,
	"principal_type" "sman"."principal_type",
	"staff_id" integer,
	"customer_id" integer,
	"type" varchar(64) NOT NULL,
	"channel" "sman"."notification_channel" NOT NULL,
	"destination" varchar(255) DEFAULT '' NOT NULL,
	"status" "sman"."notification_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" varchar(255) DEFAULT '' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "sman"."principal_type" NOT NULL,
	"staff_id" bigint,
	"customer_id" bigint,
	"category" "sman"."notification_category" NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"sms" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_principal_arc_check" CHECK (("sman"."notification_preferences"."principal_type" = 'staff'    AND "sman"."notification_preferences"."staff_id"    IS NOT NULL AND "sman"."notification_preferences"."customer_id" IS NULL)
       OR ("sman"."notification_preferences"."principal_type" = 'customer' AND "sman"."notification_preferences"."customer_id" IS NOT NULL AND "sman"."notification_preferences"."staff_id"    IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sman"."notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "sman"."principal_type" NOT NULL,
	"staff_id" bigint,
	"customer_id" bigint,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" smallint DEFAULT 1320 NOT NULL,
	"quiet_hours_end" smallint DEFAULT 420 NOT NULL,
	"timezone" varchar(64) DEFAULT '' NOT NULL,
	"locale" varchar(16) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_principal_arc_check" CHECK (("sman"."notification_settings"."principal_type" = 'staff'    AND "sman"."notification_settings"."staff_id"    IS NOT NULL AND "sman"."notification_settings"."customer_id" IS NULL)
       OR ("sman"."notification_settings"."principal_type" = 'customer' AND "sman"."notification_settings"."customer_id" IS NOT NULL AND "sman"."notification_settings"."staff_id"    IS NULL)),
	CONSTRAINT "notification_settings_quiet_hours_range_check" CHECK ("sman"."notification_settings"."quiet_hours_start" BETWEEN 0 AND 1439 AND "sman"."notification_settings"."quiet_hours_end" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
CREATE TABLE "sman"."message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"subject" varchar(200) DEFAULT '',
	"body" text NOT NULL,
	"channels" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."wa_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wa_phone" varchar(30) NOT NULL,
	"customer_id" bigint,
	"state" "sman"."wa_session_state" DEFAULT 'MENU' NOT NULL,
	"cart" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_order_id" bigint,
	"failure_count" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."wa_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"wamid" varchar(128),
	"direction" "sman"."wa_message_direction" NOT NULL,
	"wa_phone" varchar(30) NOT NULL,
	"session_id" integer,
	"customer_id" bigint,
	"in_reply_to" integer,
	"payload" jsonb NOT NULL,
	"status" "sman"."wa_message_status" NOT NULL,
	"error" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."wa_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"category" varchar(40) DEFAULT '',
	"meta_status" "sman"."wa_template_status" DEFAULT 'pending' NOT NULL,
	"body" text DEFAULT '',
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sman"."customer_identities" ADD CONSTRAINT "customer_identities_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_trusted_devices" ADD CONSTRAINT "customer_trusted_devices_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_passkeys" ADD CONSTRAINT "customer_passkeys_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_otps" ADD CONSTRAINT "customer_otps_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."driver_truck_history" ADD CONSTRAINT "driver_truck_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "sman"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."driver_truck_history" ADD CONSTRAINT "driver_truck_history_truck_id_consumer_fleettruck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."consumer_fleettruck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_staff" ADD CONSTRAINT "depot_staff_depot_id_consumer_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."consumer_depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_staff" ADD CONSTRAINT "depot_staff_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_price_history" ADD CONSTRAINT "depot_price_history_depot_product_price_id_consumer_productprice_id_fk" FOREIGN KEY ("depot_product_price_id") REFERENCES "public"."consumer_productprice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_product_capacities" ADD CONSTRAINT "depot_product_capacities_depot_id_consumer_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."consumer_depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_product_capacities" ADD CONSTRAINT "depot_product_capacities_product_id_consumer_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."consumer_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_product_commissions" ADD CONSTRAINT "depot_product_commissions_depot_id_consumer_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."consumer_depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."depot_product_commissions" ADD CONSTRAINT "depot_product_commissions_product_id_consumer_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."consumer_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."wallet_holds" ADD CONSTRAINT "wallet_holds_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."wallet_holds" ADD CONSTRAINT "wallet_holds_order_id_consumer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."consumer_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."wallet_holds" ADD CONSTRAINT "wallet_holds_deposit_id_consumer_orderpaymentrecord_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."consumer_orderpaymentrecord"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."expected_payments" ADD CONSTRAINT "expected_payments_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."expected_payments" ADD CONSTRAINT "expected_payments_order_id_consumer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."consumer_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."expected_payments" ADD CONSTRAINT "expected_payments_depot_id_consumer_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."consumer_depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."expected_payments" ADD CONSTRAINT "expected_payments_pfi_id_consumer_pfi_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."consumer_pfi"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."expected_payments" ADD CONSTRAINT "expected_payments_matched_deposit_id_consumer_orderpaymentrecord_id_fk" FOREIGN KEY ("matched_deposit_id") REFERENCES "public"."consumer_orderpaymentrecord"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."expected_payments" ADD CONSTRAINT "expected_payments_created_by_administration_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."order_deposit_allocations" ADD CONSTRAINT "order_deposit_allocations_order_id_consumer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."consumer_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."order_deposit_allocations" ADD CONSTRAINT "order_deposit_allocations_deposit_id_consumer_orderpaymentrecord_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."consumer_orderpaymentrecord"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."commissions" ADD CONSTRAINT "commissions_order_id_consumer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."consumer_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."commissions" ADD CONSTRAINT "commissions_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."commissions" ADD CONSTRAINT "commissions_depot_id_consumer_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."consumer_depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."commissions" ADD CONSTRAINT "commissions_product_id_consumer_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."consumer_product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."commissions" ADD CONSTRAINT "commissions_paid_by_administration_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."vendors" ADD CONSTRAINT "vendors_created_by_administration_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."pfi_expense_extras" ADD CONSTRAINT "pfi_expense_extras_expense_id_consumer_pfiexpense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."consumer_pfiexpense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."pfi_expense_extras" ADD CONSTRAINT "pfi_expense_extras_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "sman"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."pfi_expense_comments" ADD CONSTRAINT "pfi_expense_comments_expense_id_consumer_pfiexpense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."consumer_pfiexpense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."pfi_expense_comments" ADD CONSTRAINT "pfi_expense_comments_author_id_administration_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."expense_category_extras" ADD CONSTRAINT "expense_category_extras_category_id_consumer_expensecategory_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."consumer_expensecategory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."bank_account_extras" ADD CONSTRAINT "bank_account_extras_bank_account_id_consumer_bankacct_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."consumer_bankacct"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."lpg_station_cylinders" ADD CONSTRAINT "lpg_station_cylinders_lpg_station_id_consumer_lpgplant_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."consumer_lpgplant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."lpg_price_history" ADD CONSTRAINT "lpg_price_history_lpg_station_id_consumer_lpgplant_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."consumer_lpgplant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."lpg_station_extras" ADD CONSTRAINT "lpg_station_extras_lpg_station_id_consumer_lpgplant_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."consumer_lpgplant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_licenses" ADD CONSTRAINT "customer_licenses_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."customer_licenses" ADD CONSTRAINT "customer_licenses_verified_by_administration_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."dangote_order_requests" ADD CONSTRAINT "dangote_order_requests_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."dangote_order_requests" ADD CONSTRAINT "dangote_order_requests_license_id_customer_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "sman"."customer_licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."dangote_order_requests" ADD CONSTRAINT "dangote_order_requests_reviewed_by_administration_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."staff_page_overrides" ADD CONSTRAINT "staff_page_overrides_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."staff_password_resets" ADD CONSTRAINT "staff_password_resets_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."device_tokens" ADD CONSTRAINT "device_tokens_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."device_tokens" ADD CONSTRAINT "device_tokens_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."notifications" ADD CONSTRAINT "notifications_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."notifications" ADD CONSTRAINT "notifications_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "sman"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."notification_preferences" ADD CONSTRAINT "notification_preferences_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."notification_preferences" ADD CONSTRAINT "notification_preferences_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."notification_settings" ADD CONSTRAINT "notification_settings_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."notification_settings" ADD CONSTRAINT "notification_settings_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."message_templates" ADD CONSTRAINT "message_templates_created_by_administration_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."administration_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."wa_sessions" ADD CONSTRAINT "wa_sessions_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."wa_sessions" ADD CONSTRAINT "wa_sessions_last_order_id_consumer_order_id_fk" FOREIGN KEY ("last_order_id") REFERENCES "public"."consumer_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."wa_messages" ADD CONSTRAINT "wa_messages_session_id_wa_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sman"."wa_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."wa_messages" ADD CONSTRAINT "wa_messages_customer_id_consumer_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."consumer_customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_provider_uid_idx" ON "sman"."customer_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_customer_provider_idx" ON "sman"."customer_identities" USING btree ("customer_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_trusted_devices_token_idx" ON "sman"."customer_trusted_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_trusted_devices_customer_idx" ON "sman"."customer_trusted_devices" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_passkeys_credential_idx" ON "sman"."customer_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "customer_passkeys_customer_idx" ON "sman"."customer_passkeys" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_challenges_challenge_idx" ON "sman"."webauthn_challenges" USING btree ("challenge");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expires_idx" ON "sman"."webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customer_otps_lookup_idx" ON "sman"."customer_otps" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_otps_sweep_idx" ON "sman"."customer_otps" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customer_otps_created_idx" ON "sman"."customer_otps" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_license_number_idx" ON "sman"."drivers" USING btree ("license_number");--> statement-breakpoint
CREATE INDEX "drivers_status_idx" ON "sman"."drivers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drivers_truck_idx" ON "sman"."drivers" USING btree ("assigned_truck_ref");--> statement-breakpoint
CREATE INDEX "driver_truck_history_driver_idx" ON "sman"."driver_truck_history" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_truck_history_truck_idx" ON "sman"."driver_truck_history" USING btree ("truck_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depot_staff_unique_idx" ON "sman"."depot_staff" USING btree ("depot_id","staff_id");--> statement-breakpoint
CREATE INDEX "depot_staff_depot_idx" ON "sman"."depot_staff" USING btree ("depot_id");--> statement-breakpoint
CREATE INDEX "depot_staff_staff_idx" ON "sman"."depot_staff" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "depot_price_history_parent_idx" ON "sman"."depot_price_history" USING btree ("depot_product_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depot_product_cap_unique_idx" ON "sman"."depot_product_capacities" USING btree ("depot_id","product_id");--> statement-breakpoint
CREATE INDEX "depot_product_cap_depot_idx" ON "sman"."depot_product_capacities" USING btree ("depot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depot_product_commission_unique_idx" ON "sman"."depot_product_commissions" USING btree ("depot_id","product_id");--> statement-breakpoint
CREATE INDEX "depot_product_commission_depot_idx" ON "sman"."depot_product_commissions" USING btree ("depot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_holds_order_idx" ON "sman"."wallet_holds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "wallet_holds_customer_status_idx" ON "sman"."wallet_holds" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "webhook_events_status_created_idx" ON "sman"."webhook_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "expected_payments_customer_status_idx" ON "sman"."expected_payments" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "expected_payments_order_idx" ON "sman"."expected_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_deposit_allocations_order_deposit_idx" ON "sman"."order_deposit_allocations" USING btree ("order_id","deposit_id");--> statement-breakpoint
CREATE INDEX "order_deposit_allocations_deposit_idx" ON "sman"."order_deposit_allocations" USING btree ("deposit_id");--> statement-breakpoint
CREATE INDEX "commissions_order_idx" ON "sman"."commissions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commissions_customer_idx" ON "sman"."commissions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "commissions_status_idx" ON "sman"."commissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commissions_depot_product_idx" ON "sman"."commissions" USING btree ("depot_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_idx" ON "sman"."vendors" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "pfi_expense_comments_expense_idx" ON "sman"."pfi_expense_comments" USING btree ("expense_id","created_at");--> statement-breakpoint
CREATE INDEX "lpg_station_cylinders_station_idx" ON "sman"."lpg_station_cylinders" USING btree ("lpg_station_id");--> statement-breakpoint
CREATE INDEX "lpg_price_history_station_idx" ON "sman"."lpg_price_history" USING btree ("lpg_station_id");--> statement-breakpoint
CREATE INDEX "customer_licenses_customer_id_idx" ON "sman"."customer_licenses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_licenses_status_idx" ON "sman"."customer_licenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dangote_products_status_idx" ON "sman"."dangote_products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dangote_requests_status_idx" ON "sman"."dangote_order_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dangote_requests_customer_idx" ON "sman"."dangote_order_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_page_overrides_unique_idx" ON "sman"."staff_page_overrides" USING btree ("staff_id","route_path");--> statement-breakpoint
CREATE INDEX "staff_page_overrides_staff_idx" ON "sman"."staff_page_overrides" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_password_resets_token_idx" ON "sman"."staff_password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_password_resets_staff_idx" ON "sman"."staff_password_resets" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_idx" ON "sman"."device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "device_tokens_staff_idx" ON "sman"."device_tokens" USING btree ("staff_id") WHERE "sman"."device_tokens"."disabled_at" IS NULL AND "sman"."device_tokens"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "device_tokens_customer_idx" ON "sman"."device_tokens" USING btree ("customer_id") WHERE "sman"."device_tokens"."disabled_at" IS NULL AND "sman"."device_tokens"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "device_tokens_device_idx" ON "sman"."device_tokens" USING btree ("device_id") WHERE "sman"."device_tokens"."device_id" <> '';--> statement-breakpoint
CREATE INDEX "notifications_staff_idx" ON "sman"."notifications" USING btree ("staff_id","created_at") WHERE "sman"."notifications"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_customer_idx" ON "sman"."notifications" USING btree ("customer_id","created_at") WHERE "sman"."notifications"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_staff_unread_idx" ON "sman"."notifications" USING btree ("staff_id") WHERE "sman"."notifications"."read_at" IS NULL AND "sman"."notifications"."archived_at" IS NULL AND "sman"."notifications"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_customer_unread_idx" ON "sman"."notifications" USING btree ("customer_id") WHERE "sman"."notifications"."read_at" IS NULL AND "sman"."notifications"."archived_at" IS NULL AND "sman"."notifications"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "sman"."notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_idx" ON "sman"."notifications" USING btree ("dedupe_key") WHERE "sman"."notifications"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_idx" ON "sman"."notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_channel_status_idx" ON "sman"."notification_deliveries" USING btree ("channel","status","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_type_idx" ON "sman"."notification_deliveries" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_staff_idx" ON "sman"."notification_deliveries" USING btree ("staff_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_customer_idx" ON "sman"."notification_deliveries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_staff_idx" ON "sman"."notification_preferences" USING btree ("staff_id","category") WHERE "sman"."notification_preferences"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_customer_idx" ON "sman"."notification_preferences" USING btree ("customer_id","category") WHERE "sman"."notification_preferences"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_staff_idx" ON "sman"."notification_settings" USING btree ("staff_id") WHERE "sman"."notification_settings"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_customer_idx" ON "sman"."notification_settings" USING btree ("customer_id") WHERE "sman"."notification_settings"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_name_idx" ON "sman"."message_templates" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "wa_sessions_phone_idx" ON "sman"."wa_sessions" USING btree ("wa_phone");--> statement-breakpoint
CREATE INDEX "wa_sessions_expires_idx" ON "sman"."wa_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_wamid_idx" ON "sman"."wa_messages" USING btree ("wamid") WHERE "sman"."wa_messages"."wamid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wa_messages_session_idx" ON "sman"."wa_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_phone_dir_idx" ON "sman"."wa_messages" USING btree ("wa_phone","direction","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_status_idx" ON "sman"."wa_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_reply_to_idx" ON "sman"."wa_messages" USING btree ("in_reply_to");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_templates_name_idx" ON "sman"."wa_templates" USING btree ("name","language");