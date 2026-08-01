CREATE TYPE "public"."statement_line_status" AS ENUM('UNMATCHED', 'MATCHED');--> statement-breakpoint
CREATE TABLE "bank_statement_column_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" integer NOT NULL,
	"header_row" integer DEFAULT 0 NOT NULL,
	"date_column" integer NOT NULL,
	"amount_column" integer,
	"credit_column" integer,
	"depositor_column" integer,
	"reference_column" integer,
	"narration_column" integer,
	"sample_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" integer NOT NULL,
	"filename" varchar(255) DEFAULT '' NOT NULL,
	"uploaded_by" integer,
	"row_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" integer NOT NULL,
	"statement_id" integer NOT NULL,
	"txn_date" timestamp with time zone NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"depositor" varchar(255) DEFAULT '' NOT NULL,
	"bank_ref" varchar(255) DEFAULT '' NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"raw_row" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedup_key" varchar(32) NOT NULL,
	"status" "statement_line_status" DEFAULT 'UNMATCHED' NOT NULL,
	"matched_order_id" integer,
	"matched_deposit_id" integer,
	"matched_by" integer,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_statement_column_mappings" ADD CONSTRAINT "bank_statement_column_mappings_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bscm_bank_account_unique" ON "bank_statement_column_mappings" USING btree ("bank_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bsl_account_dedup_unique" ON "bank_statement_lines" USING btree ("bank_account_id","dedup_key");--> statement-breakpoint
CREATE INDEX "bsl_pool_idx" ON "bank_statement_lines" USING btree ("bank_account_id","status");