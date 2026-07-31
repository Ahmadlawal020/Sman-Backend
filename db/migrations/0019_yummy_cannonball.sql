CREATE TYPE "public"."dangote_delivery_status" AS ENUM('DRAFT', 'DOCUMENTS_SUBMITTED', 'AGREEMENT_ACCEPTED', 'UNDER_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'SCHEDULED', 'DISPATCHED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'DOCUMENTS_EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."dangote_document_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint

-- ── Rename, never recreate: every existing request row survives with its id ──
ALTER TABLE "dangote_order_requests" RENAME TO "dangote_delivery_orders";--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" RENAME CONSTRAINT "dangote_order_requests_customer_id_customers_id_fk" TO "dangote_delivery_orders_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" RENAME CONSTRAINT "dangote_order_requests_reviewed_by_staff_id_fk" TO "dangote_delivery_orders_reviewed_by_staff_id_fk";--> statement-breakpoint
ALTER INDEX "dangote_requests_customer_idx" RENAME TO "dangote_delivery_orders_customer_idx";--> statement-breakpoint
DROP INDEX "dangote_requests_status_idx";--> statement-breakpoint

-- ── Column evolution ──
ALTER TABLE "dangote_delivery_orders" RENAME COLUMN "product" TO "product_name";--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" RENAME COLUMN "price_per_unit" TO "unit_price";--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ALTER COLUMN "quantity_unit" SET DEFAULT 'litre';--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "product_id" integer;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "product_code" varchar(20) DEFAULT '';--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "contact_person" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "contact_phone" varchar(50) DEFAULT '';--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "company_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "company_name_normalized" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "quoted_by" integer;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "quoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD CONSTRAINT "dangote_delivery_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD CONSTRAINT "dangote_delivery_orders_quoted_by_staff_id_fk" FOREIGN KEY ("quoted_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD CONSTRAINT "dangote_delivery_orders_quantity_unit_check" CHECK ("quantity_unit" IN ('litre', 'kg', 'Tons'));--> statement-breakpoint

-- ── Collapse the three loose status tracks into the enum machine ──
-- Final status = furthest stage reached; impossible combinations degrade
-- safely (e.g. Rejected always wins over Paid).
ALTER TABLE "dangote_delivery_orders" RENAME COLUMN "status" TO "legacy_status";--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" ADD COLUMN "status" "dangote_delivery_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
UPDATE "dangote_delivery_orders" SET "status" = CASE
  WHEN "legacy_status" = 'Rejected' THEN 'REJECTED'::"dangote_delivery_status"
  WHEN "legacy_status" = 'Approved' AND "payment_status" = 'Paid' AND "collection_status" = 'Collected' THEN 'COMPLETED'::"dangote_delivery_status"
  WHEN "legacy_status" = 'Approved' AND "payment_status" = 'Paid' AND "collection_status" = 'Dispatched' THEN 'DISPATCHED'::"dangote_delivery_status"
  WHEN "legacy_status" = 'Approved' AND "payment_status" = 'Paid' THEN 'PAID'::"dangote_delivery_status"
  WHEN "legacy_status" = 'Approved' THEN 'APPROVED'::"dangote_delivery_status"
  ELSE 'UNDER_REVIEW'::"dangote_delivery_status"
END;--> statement-breakpoint

-- ── Backfill stage stamps in order so migrated rows render a full timeline ──
UPDATE "dangote_delivery_orders" SET "submitted_at" = "created_at";--> statement-breakpoint
UPDATE "dangote_delivery_orders" SET
  "approved_at" = COALESCE("reviewed_at", "created_at"),
  "quoted_at" = COALESCE("reviewed_at", "created_at"),
  "quoted_by" = "reviewed_by"
WHERE "status" IN ('APPROVED', 'PAID', 'DISPATCHED', 'COMPLETED');--> statement-breakpoint
UPDATE "dangote_delivery_orders" SET "paid_at" = "updated_at" WHERE "status" IN ('PAID', 'DISPATCHED', 'COMPLETED');--> statement-breakpoint
UPDATE "dangote_delivery_orders" SET "dispatched_at" = "updated_at" WHERE "status" IN ('DISPATCHED', 'COMPLETED');--> statement-breakpoint
UPDATE "dangote_delivery_orders" SET "completed_at" = "updated_at" WHERE "status" = 'COMPLETED';--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" DROP COLUMN "legacy_status";--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" DROP COLUMN "payment_status";--> statement-breakpoint
ALTER TABLE "dangote_delivery_orders" DROP COLUMN "collection_status";--> statement-breakpoint

-- ── Request numbers: dedupe (COUNT(*)+1 generation had no unique guard),
--    then enforce uniqueness and back generation with a sequence ──
UPDATE "dangote_delivery_orders" t SET "request_number" = t."request_number" || '-D' || t."id"
WHERE EXISTS (
  SELECT 1 FROM "dangote_delivery_orders" o
  WHERE o."request_number" = t."request_number" AND o."id" < t."id"
);--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "dangote_delivery_order_number_seq" START WITH 1;--> statement-breakpoint
SELECT setval('dangote_delivery_order_number_seq', (SELECT COUNT(*) + 1 FROM "dangote_delivery_orders"), false);--> statement-breakpoint
CREATE UNIQUE INDEX "dangote_delivery_orders_request_number_idx" ON "dangote_delivery_orders" USING btree ("request_number");--> statement-breakpoint
CREATE INDEX "dangote_delivery_orders_status_idx" ON "dangote_delivery_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dangote_delivery_orders_company_reuse_idx" ON "dangote_delivery_orders" USING btree ("customer_id","company_name_normalized");--> statement-breakpoint

-- ── Child tables ──
CREATE TABLE "dangote_delivery_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"company_name" varchar(255) DEFAULT '',
	"delivery_address" text NOT NULL,
	"delivery_state" varchar(100) DEFAULT '',
	"product_code" varchar(20) DEFAULT '',
	"product_name" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_unit" varchar(20) NOT NULL,
	"signature_full_name" varchar(255) NOT NULL,
	"signature_initials" varchar(20) DEFAULT '',
	"signed_at" timestamp with time zone NOT NULL,
	"terms_version" varchar(20) NOT NULL,
	"user_agent" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dangote_delivery_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"document_type" varchar(50) DEFAULT 'DPR_NUPRC_LICENSE' NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"status" "dangote_document_status" DEFAULT 'PENDING' NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dangote_delivery_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"event" varchar(100) NOT NULL,
	"note" text DEFAULT '',
	"actor_type" "audit_actor_type" DEFAULT 'system' NOT NULL,
	"actor_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dangote_delivery_agreements" ADD CONSTRAINT "dangote_delivery_agreements_order_id_dangote_delivery_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dangote_delivery_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dangote_delivery_documents" ADD CONSTRAINT "dangote_delivery_documents_order_id_dangote_delivery_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dangote_delivery_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dangote_delivery_documents" ADD CONSTRAINT "dangote_delivery_documents_verified_by_staff_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dangote_delivery_events" ADD CONSTRAINT "dangote_delivery_events_order_id_dangote_delivery_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."dangote_delivery_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dangote_delivery_agreements_order_idx" ON "dangote_delivery_agreements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "dangote_delivery_documents_order_idx" ON "dangote_delivery_documents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "dangote_delivery_documents_storage_key_idx" ON "dangote_delivery_documents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "dangote_delivery_events_order_idx" ON "dangote_delivery_events" USING btree ("order_id");--> statement-breakpoint

-- ── Timeline backfill: one event per inferred stage so migrated rows show a
--    full tracker, not a bare final status ──
INSERT INTO "dangote_delivery_events" ("order_id", "event", "note", "actor_type", "created_at")
SELECT "id", 'UNDER_REVIEW', 'Migrated from legacy status fields', 'system', "created_at"
FROM "dangote_delivery_orders";--> statement-breakpoint
INSERT INTO "dangote_delivery_events" ("order_id", "event", "note", "actor_type", "created_at")
SELECT "id", 'APPROVED', 'Migrated from legacy status fields', 'system', COALESCE("reviewed_at", "created_at")
FROM "dangote_delivery_orders" WHERE "status" IN ('APPROVED', 'PAID', 'DISPATCHED', 'COMPLETED');--> statement-breakpoint
INSERT INTO "dangote_delivery_events" ("order_id", "event", "note", "actor_type", "created_at")
SELECT "id", 'REJECTED', 'Migrated from legacy status fields', 'system', COALESCE("reviewed_at", "updated_at")
FROM "dangote_delivery_orders" WHERE "status" = 'REJECTED';--> statement-breakpoint
INSERT INTO "dangote_delivery_events" ("order_id", "event", "note", "actor_type", "created_at")
SELECT "id", 'PAID', 'Migrated from legacy status fields', 'system', "updated_at"
FROM "dangote_delivery_orders" WHERE "status" IN ('PAID', 'DISPATCHED', 'COMPLETED');--> statement-breakpoint
INSERT INTO "dangote_delivery_events" ("order_id", "event", "note", "actor_type", "created_at")
SELECT "id", 'DISPATCHED', 'Migrated from legacy status fields', 'system', "updated_at"
FROM "dangote_delivery_orders" WHERE "status" IN ('DISPATCHED', 'COMPLETED');--> statement-breakpoint
INSERT INTO "dangote_delivery_events" ("order_id", "event", "note", "actor_type", "created_at")
SELECT "id", 'COMPLETED', 'Migrated from legacy status fields', 'system', "updated_at"
FROM "dangote_delivery_orders" WHERE "status" = 'COMPLETED';
