CREATE TYPE "public"."report_type" AS ENUM('sales_manager', 'product_manager', 'security_gate', 'commissions', 'it_compliance');--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "report_type" "report_type" DEFAULT 'sales_manager' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "customer_count" integer;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "order_count" integer;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "rates" text DEFAULT '';
--> statement-breakpoint
-- The 296 existing rows are all daily sales reports; the column default would
-- have labelled them correctly anyway, but say so explicitly so the intent
-- survives in the history rather than resting on a default.
UPDATE daily_reports SET report_type = 'sales_manager' WHERE report_type IS NULL;
