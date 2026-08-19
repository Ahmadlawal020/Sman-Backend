CREATE TYPE "public"."license_verification_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD COLUMN "status" "license_verification_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD COLUMN "verified_by" integer;--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD COLUMN "verified_by_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD COLUMN "verification_comment" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD CONSTRAINT "customer_licenses_verified_by_staff_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_licenses_status_idx" ON "customer_licenses" USING btree ("status");