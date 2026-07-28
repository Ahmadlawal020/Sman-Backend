-- bank_accounts predates this migration on existing databases (it was pushed
-- without a migration file); IF NOT EXISTS folds that drift back into the
-- migration history so a fresh install and a live database both converge.
CREATE TABLE IF NOT EXISTS "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_name" varchar(100) NOT NULL,
	"account_name" varchar(255) NOT NULL,
	"account_number" varchar(50) NOT NULL,
	"bank_code" varchar(50) DEFAULT '',
	"branch_name" varchar(150) DEFAULT '',
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"status" varchar(20) DEFAULT 'Active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"depot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_address" text DEFAULT '' NOT NULL;