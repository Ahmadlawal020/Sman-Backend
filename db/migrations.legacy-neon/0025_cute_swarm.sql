CREATE TABLE "lpg_order_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"lpg_station_id" integer NOT NULL,
	"cylinder_size_kg" integer NOT NULL,
	"cylinder_quantity" integer NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_state" varchar(100) DEFAULT '',
	"delivery_lga" varchar(100) DEFAULT '',
	"status" varchar(30) DEFAULT 'Pending Review' NOT NULL,
	"payment_status" varchar(20) DEFAULT 'Unpaid' NOT NULL,
	"collection_status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"price_per_kg" numeric(15, 2),
	"delivery_price" numeric(15, 2),
	"total_amount" numeric(15, 2),
	"expected_arrival_date" varchar(20),
	"payment_reference" varchar(100),
	"payment_mode" varchar(50),
	"virtual_account_number" varchar(30) DEFAULT '',
	"virtual_account_bank" varchar(100) DEFAULT '',
	"virtual_account_name" varchar(255) DEFAULT '',
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lpg_order_requests" ADD CONSTRAINT "lpg_order_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lpg_order_requests" ADD CONSTRAINT "lpg_order_requests_lpg_station_id_lpg_stations_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."lpg_stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lpg_order_requests" ADD CONSTRAINT "lpg_order_requests_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lpg_requests_status_idx" ON "lpg_order_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lpg_requests_customer_idx" ON "lpg_order_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "lpg_requests_station_idx" ON "lpg_order_requests" USING btree ("lpg_station_id");