ALTER TABLE "daily_reports" ADD COLUMN "yesterday_deficit_payment" numeric(15, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "yesterday_surplus_payment" numeric(15, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "total_inflow" numeric(15, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "trucks_entered" integer;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "top_customers" jsonb DEFAULT '[]'::jsonb;