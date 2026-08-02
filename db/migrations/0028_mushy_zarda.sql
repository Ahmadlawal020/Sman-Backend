ALTER TYPE "public"."order_status" ADD VALUE 'Expired';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expired_at" timestamp with time zone;