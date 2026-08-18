CREATE TYPE "public"."customer_created_via" AS ENUM('desk', 'portal', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."wa_session_state" AS ENUM('IDENTIFY', 'MENU', 'DEPOT', 'PRODUCT', 'QUANTITY', 'COLLECT', 'LOGISTICS', 'CONFIRM', 'AWAIT_PAYMENT');--> statement-breakpoint
CREATE TYPE "public"."wa_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."wa_message_status" AS ENUM('received', 'processed', 'queued', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."wa_template_status" AS ENUM('pending', 'approved', 'rejected', 'paused');--> statement-breakpoint
CREATE TABLE "wa_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wa_phone" varchar(30) NOT NULL,
	"customer_id" integer,
	"state" "wa_session_state" DEFAULT 'MENU' NOT NULL,
	"cart" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_order_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"wamid" varchar(128) NOT NULL,
	"direction" "wa_message_direction" NOT NULL,
	"wa_phone" varchar(30) NOT NULL,
	"session_id" integer,
	"customer_id" integer,
	"payload" jsonb NOT NULL,
	"status" "wa_message_status" NOT NULL,
	"error" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"category" varchar(40) DEFAULT '',
	"meta_status" "wa_template_status" DEFAULT 'pending' NOT NULL,
	"body" text DEFAULT '',
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "created_via" "customer_created_via" DEFAULT 'desk' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_key" varchar(128);--> statement-breakpoint
ALTER TABLE "wa_sessions" ADD CONSTRAINT "wa_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_sessions" ADD CONSTRAINT "wa_sessions_last_order_id_orders_id_fk" FOREIGN KEY ("last_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_session_id_wa_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."wa_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_sessions_phone_idx" ON "wa_sessions" USING btree ("wa_phone");--> statement-breakpoint
CREATE INDEX "wa_sessions_expires_idx" ON "wa_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_wamid_idx" ON "wa_messages" USING btree ("wamid");--> statement-breakpoint
CREATE INDEX "wa_messages_session_idx" ON "wa_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_phone_dir_idx" ON "wa_messages" USING btree ("wa_phone","direction","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_status_idx" ON "wa_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_templates_name_idx" ON "wa_templates" USING btree ("name","language");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_idx" ON "orders" USING btree ("idempotency_key") WHERE "orders"."idempotency_key" IS NOT NULL;