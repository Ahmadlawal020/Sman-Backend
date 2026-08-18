CREATE TYPE "public"."commission_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"depot_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"commission_rate" numeric(15, 2) NOT NULL,
	"commission_amount" numeric(15, 2) NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commissions_quantity_check" CHECK ("commissions"."quantity" > 0),
	CONSTRAINT "commissions_rate_check" CHECK ("commissions"."commission_rate" >= 0),
	CONSTRAINT "commissions_amount_check" CHECK ("commissions"."commission_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "depot_product_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"depot_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"commission_rate" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depot_product_commission_rate_check" CHECK ("depot_product_commissions"."commission_rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "commission_bank_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "commission_account_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "commission_account_number" varchar(30) DEFAULT '';--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_paid_by_staff_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_product_commissions" ADD CONSTRAINT "depot_product_commissions_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depot_product_commissions" ADD CONSTRAINT "depot_product_commissions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commissions_order_idx" ON "commissions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commissions_customer_idx" ON "commissions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "commissions_status_idx" ON "commissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commissions_depot_product_idx" ON "commissions" USING btree ("depot_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depot_product_commission_unique_idx" ON "depot_product_commissions" USING btree ("depot_id","product_id");--> statement-breakpoint
CREATE INDEX "depot_product_commission_depot_idx" ON "depot_product_commissions" USING btree ("depot_id");