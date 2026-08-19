CREATE TYPE "public"."principal_type" AS ENUM('staff', 'customer');--> statement-breakpoint
ALTER TYPE "public"."customer_status" ADD VALUE 'Pending';--> statement-breakpoint
CREATE TABLE "customer_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"code_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"request_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" "principal_type" NOT NULL,
	"staff_id" integer,
	"customer_id" integer,
	"refresh_token_hash" char(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"replaced_by_id" integer,
	"revoked_reason" varchar(32),
	"device_name" varchar(255) DEFAULT '',
	"user_agent" text,
	"ip_address" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_principal_arc_check" CHECK (("sessions"."principal_type" = 'staff'    AND "sessions"."staff_id"    IS NOT NULL AND "sessions"."customer_id" IS NULL)
       OR ("sessions"."principal_type" = 'customer' AND "sessions"."customer_id" IS NOT NULL AND "sessions"."staff_id"    IS NULL))
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_otps" ADD CONSTRAINT "customer_otps_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_otps_lookup_idx" ON "customer_otps" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_otps_sweep_idx" ON "customer_otps" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customer_otps_created_idx" ON "customer_otps" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_idx" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_staff_idx" ON "sessions" USING btree ("staff_id","created_at") WHERE "sessions"."staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_customer_idx" ON "sessions" USING btree ("customer_id","created_at") WHERE "sessions"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at") WHERE "sessions"."revoked_at" IS NULL;