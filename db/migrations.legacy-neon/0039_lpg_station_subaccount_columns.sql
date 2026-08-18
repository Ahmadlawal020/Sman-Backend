ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "lpg_station_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lpg_stations" ADD COLUMN IF NOT EXISTS "paystack_subaccount_code" varchar(100) DEFAULT '';--> statement-breakpoint
ALTER TABLE "lpg_stations" ADD COLUMN IF NOT EXISTS "subaccount_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lpg_stations" ADD COLUMN IF NOT EXISTS "subaccount_split_percentage" integer DEFAULT 100 NOT NULL;
