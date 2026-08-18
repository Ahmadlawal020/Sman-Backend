-- What a customer said they'd pay, before the money actually shows up.
--
-- Bank transfers arrive as bare depositor names/narrations with nothing to
-- tie them back to a customer. This is the note staff leave for themselves
-- ahead of time — "Jane says she'll send 50k, ref: her phone number" — so
-- that when an anonymous line turns up later, there's something concrete to
-- search against. Purely advisory: nothing here moves money or blocks a
-- deposit. order_id is set when raised from the order wizard, null when
-- raised standalone from the customer's own page.

CREATE TABLE "expected_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "order_id" integer,
  "expected_amount" numeric(15, 2),
  "reference" varchar(255) DEFAULT '',
  "note" text DEFAULT '',
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "matched_deposit_id" integer,
  "created_by" integer,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_customer_id_customers_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_matched_deposit_id_deposits_id_fk"
  FOREIGN KEY ("matched_deposit_id") REFERENCES "public"."deposits"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_created_by_staff_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expected_payments_customer_status_idx" ON "expected_payments" ("customer_id", "status");
--> statement-breakpoint
CREATE INDEX "expected_payments_order_idx" ON "expected_payments" ("order_id");
