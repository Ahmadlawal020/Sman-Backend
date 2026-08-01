CREATE TABLE "customer_licenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"company_name_normalized" varchar(255) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"storage_provider" varchar(20) DEFAULT 'local' NOT NULL,
	"storage_resource_type" varchar(20) DEFAULT '',
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"expiry_date" date,
	"status" "dangote_document_status" DEFAULT 'PENDING' NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"verification_comment" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "license_id" integer;--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD CONSTRAINT "customer_licenses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_licenses" ADD CONSTRAINT "customer_licenses_verified_by_staff_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_licenses_customer_idx" ON "customer_licenses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_licenses_reuse_idx" ON "customer_licenses" USING btree ("customer_id","company_name_normalized");--> statement-breakpoint
CREATE INDEX "customer_licenses_status_idx" ON "customer_licenses" USING btree ("status");--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD CONSTRAINT "dangote_delivery_orders_license_id_customer_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."customer_licenses"("id") ON DELETE set null ON UPDATE no action;