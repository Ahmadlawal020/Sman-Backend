CREATE TYPE "public"."wallet_hold_status" AS ENUM('active', 'converted', 'released');--> statement-breakpoint
CREATE TABLE "wallet_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" "wallet_hold_status" DEFAULT 'active' NOT NULL,
	"description" text DEFAULT '',
	"deposit_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "wallet_holds_amount_check" CHECK ("wallet_holds"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_holds_order_idx" ON "wallet_holds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "wallet_holds_customer_status_idx" ON "wallet_holds" USING btree ("customer_id","status");