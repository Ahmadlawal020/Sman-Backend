-- product_type was an unvalidated varchar passthrough; normalize any stray
-- values before the enum cast or the USING clause aborts the migration.
UPDATE "products" SET "product_type" = 'soroman' WHERE "product_type" NOT IN ('soroman', 'dangote');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('soroman', 'dangote');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "product_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "product_type" SET DATA TYPE "public"."product_type" USING "product_type"::"public"."product_type";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "product_type" SET DEFAULT 'soroman'::"public"."product_type";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" "product_status" DEFAULT 'Active' NOT NULL;--> statement-breakpoint
INSERT INTO "products" ("name", "sku", "category", "product_type", "unit", "description", "status")
VALUES
  ('Petrol', 'DNG-PMS', 'PMS', 'dangote', 'Liters', 'Dangote Refinery delivery — Premium Motor Spirit', 'Active'),
  ('Diesel', 'DNG-AGO', 'AGO', 'dangote', 'Liters', 'Dangote Refinery delivery — Automotive Gas Oil', 'Active'),
  ('LPG', 'DNG-LPG', 'LPG', 'dangote', 'kg', 'Dangote Refinery delivery — Liquefied Petroleum Gas', 'Active')
ON CONFLICT ("sku") DO NOTHING;
