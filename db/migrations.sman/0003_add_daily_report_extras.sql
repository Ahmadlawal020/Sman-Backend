CREATE TABLE "sman"."daily_report_extras" (
	"report_id" bigint PRIMARY KEY NOT NULL,
	"report_type" varchar(30) DEFAULT 'sales_manager' NOT NULL,
	"product_name" varchar(100) DEFAULT '',
	"opening_stock" numeric(15, 2) DEFAULT '0',
	"received_stock" numeric(15, 2) DEFAULT '0',
	"avg_price" numeric(12, 2) DEFAULT '0',
	"yesterday_deficit_payment" numeric(15, 2) DEFAULT '0',
	"yesterday_surplus_payment" numeric(15, 2) DEFAULT '0',
	"total_inflow" numeric(15, 2) DEFAULT '0',
	"trucks_entered" integer,
	"customer_count" integer,
	"order_count" integer,
	"rates" text DEFAULT '',
	"top_customers" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"reviewed_by" bigint,
	"reviewed_by_name" varchar(255) DEFAULT '',
	"reviewed_at" timestamp with time zone,
	"review_comment" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sman"."daily_report_extras" ADD CONSTRAINT "daily_report_extras_report_id_administration_staffdailysalesreport_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."administration_staffdailysalesreport"("id") ON DELETE cascade ON UPDATE no action;