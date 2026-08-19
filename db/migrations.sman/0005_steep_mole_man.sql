CREATE TABLE "sman"."order_idempotency" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"order_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_idempotency_key_idx" ON "sman"."order_idempotency" USING btree ("idempotency_key");