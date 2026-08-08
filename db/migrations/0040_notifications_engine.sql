CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('orders', 'payments', 'delivery', 'tickets', 'account', 'security', 'reports', 'operations', 'marketing', 'system');--> statement-breakpoint
CREATE TYPE "public"."device_token_platform" AS ENUM('android', 'ios', 'web');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'sent', 'delivered', 'failed', 'skipped', 'suppressed');--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "principal_type" NOT NULL,
	"staff_id" integer,
	"customer_id" integer,
	"token" text NOT NULL,
	"provider" varchar(16) DEFAULT 'fcm' NOT NULL,
	"platform" "device_token_platform" NOT NULL,
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
	CONSTRAINT "device_tokens_principal_arc_check" CHECK (("device_tokens"."principal_type" = 'staff'    AND "device_tokens"."staff_id"    IS NOT NULL AND "device_tokens"."customer_id" IS NULL)
       OR ("device_tokens"."principal_type" = 'customer' AND "device_tokens"."customer_id" IS NOT NULL AND "device_tokens"."staff_id"    IS NULL))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_type" "principal_type" NOT NULL,
	"staff_id" integer,
	"customer_id" integer,
	"type" varchar(64) NOT NULL,
	"category" "notification_category" NOT NULL,
	"priority" "notification_priority" DEFAULT 'normal' NOT NULL,
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
	CONSTRAINT "notifications_recipient_arc_check" CHECK (("notifications"."recipient_type" = 'staff'    AND "notifications"."staff_id"    IS NOT NULL AND "notifications"."customer_id" IS NULL)
       OR ("notifications"."recipient_type" = 'customer' AND "notifications"."customer_id" IS NOT NULL AND "notifications"."staff_id"    IS NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer,
	"principal_type" "principal_type",
	"staff_id" integer,
	"customer_id" integer,
	"type" varchar(64) NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"destination" varchar(255) DEFAULT '' NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" varchar(255) DEFAULT '' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "principal_type" NOT NULL,
	"staff_id" integer,
	"customer_id" integer,
	"category" "notification_category" NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"sms" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_principal_arc_check" CHECK (("notification_preferences"."principal_type" = 'staff'    AND "notification_preferences"."staff_id"    IS NOT NULL AND "notification_preferences"."customer_id" IS NULL)
       OR ("notification_preferences"."principal_type" = 'customer' AND "notification_preferences"."customer_id" IS NOT NULL AND "notification_preferences"."staff_id"    IS NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "principal_type" NOT NULL,
	"staff_id" integer,
	"customer_id" integer,
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
	CONSTRAINT "notification_settings_principal_arc_check" CHECK (("notification_settings"."principal_type" = 'staff'    AND "notification_settings"."staff_id"    IS NOT NULL AND "notification_settings"."customer_id" IS NULL)
       OR ("notification_settings"."principal_type" = 'customer' AND "notification_settings"."customer_id" IS NOT NULL AND "notification_settings"."staff_id"    IS NULL)),
	CONSTRAINT "notification_settings_quiet_hours_range_check" CHECK ("notification_settings"."quiet_hours_start" BETWEEN 0 AND 1439 AND "notification_settings"."quiet_hours_end" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_idx" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "device_tokens_staff_idx" ON "device_tokens" USING btree ("staff_id") WHERE "device_tokens"."disabled_at" IS NULL AND "device_tokens"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "device_tokens_customer_idx" ON "device_tokens" USING btree ("customer_id") WHERE "device_tokens"."disabled_at" IS NULL AND "device_tokens"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "device_tokens_device_idx" ON "device_tokens" USING btree ("device_id") WHERE "device_tokens"."device_id" <> '';--> statement-breakpoint
CREATE INDEX "notifications_staff_idx" ON "notifications" USING btree ("staff_id","created_at") WHERE "notifications"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_customer_idx" ON "notifications" USING btree ("customer_id","created_at") WHERE "notifications"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_staff_unread_idx" ON "notifications" USING btree ("staff_id") WHERE "notifications"."read_at" IS NULL AND "notifications"."archived_at" IS NULL AND "notifications"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_customer_unread_idx" ON "notifications" USING btree ("customer_id") WHERE "notifications"."read_at" IS NULL AND "notifications"."archived_at" IS NULL AND "notifications"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_idx" ON "notifications" USING btree ("dedupe_key") WHERE "notifications"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_idx" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_channel_status_idx" ON "notification_deliveries" USING btree ("channel","status","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_type_idx" ON "notification_deliveries" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_staff_idx" ON "notification_deliveries" USING btree ("staff_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_customer_idx" ON "notification_deliveries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_staff_idx" ON "notification_preferences" USING btree ("staff_id","category") WHERE "notification_preferences"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_customer_idx" ON "notification_preferences" USING btree ("customer_id","category") WHERE "notification_preferences"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_staff_idx" ON "notification_settings" USING btree ("staff_id") WHERE "notification_settings"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_customer_idx" ON "notification_settings" USING btree ("customer_id") WHERE "notification_settings"."customer_id" IS NOT NULL;