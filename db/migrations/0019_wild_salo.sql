ALTER TABLE "customer_licenses" ADD COLUMN "license_url" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD COLUMN "license_public_id" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "customer_licenses" DROP COLUMN "license_file";