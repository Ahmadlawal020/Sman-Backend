ALTER TABLE "depots" ADD COLUMN IF NOT EXISTS "paystack_subaccount_code" varchar(100) DEFAULT '';--> statement-breakpoint
ALTER TABLE "depots" ADD COLUMN IF NOT EXISTS "subaccount_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "depots" ADD COLUMN IF NOT EXISTS "subaccount_split_percentage" integer DEFAULT 100 NOT NULL;