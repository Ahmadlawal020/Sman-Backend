CREATE TABLE "order_pfi_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"pfi_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_pfi_allocations" ADD CONSTRAINT "order_pfi_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_pfi_allocations" ADD CONSTRAINT "order_pfi_allocations_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opa_order_idx" ON "order_pfi_allocations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "opa_pfi_idx" ON "order_pfi_allocations" USING btree ("pfi_id");