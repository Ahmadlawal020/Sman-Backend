CREATE TABLE "dangote_order_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"product" varchar(255) NOT NULL,
	"plant" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_unit" varchar(20) DEFAULT 'Tons' NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_state" varchar(100) DEFAULT '',
	"delivery_lga" varchar(100) DEFAULT '',
	"status" varchar(30) DEFAULT 'Pending Review' NOT NULL,
	"price_per_unit" numeric(15, 2),
	"delivery_price" numeric(15, 2),
	"total_amount" numeric(15, 2),
	"expected_arrival_date" varchar(20),
	"payment_reference" varchar(100),
	"payment_mode" varchar(50),
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dangote_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"sku" varchar(50) NOT NULL,
	"category" varchar(100) NOT NULL,
	"unit" varchar(30) DEFAULT 'Tons' NOT NULL,
	"description" text DEFAULT '',
	"plants" text DEFAULT '[]' NOT NULL,
	"status" varchar(20) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dangote_order_requests" ADD CONSTRAINT "dangote_order_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dangote_order_requests" ADD CONSTRAINT "dangote_order_requests_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dangote_requests_status_idx" ON "dangote_order_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dangote_requests_customer_idx" ON "dangote_order_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "dangote_products_status_idx" ON "dangote_products" USING btree ("status");