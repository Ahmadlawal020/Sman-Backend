CREATE TYPE "public"."audit_actor_type" AS ENUM('staff', 'customer', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_truck_status" AS ENUM('pending', 'gated_in', 'loaded', 'gated_out');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'Paid' BEFORE 'Completed';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'Released' BEFORE 'Completed';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'Loading' BEFORE 'Completed';--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"prev_state" varchar(32),
	"new_state" varchar(32),
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_staff_id" integer,
	"actor_customer_id" integer,
	"metadata" jsonb,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_arc_check" CHECK (("audit_logs"."actor_type" = 'staff'    AND "audit_logs"."actor_staff_id"    IS NOT NULL AND "audit_logs"."actor_customer_id" IS NULL)
       OR ("audit_logs"."actor_type" = 'customer' AND "audit_logs"."actor_customer_id" IS NOT NULL AND "audit_logs"."actor_staff_id"    IS NULL)
       OR ("audit_logs"."actor_type" = 'system'   AND "audit_logs"."actor_staff_id"    IS NULL     AND "audit_logs"."actor_customer_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "order_trucks" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"truck_index" smallint NOT NULL,
	"truck_id" integer,
	"truck_number" varchar(100),
	"quantity" numeric(15, 2) NOT NULL,
	"compartments" jsonb,
	"driver_name" varchar(255),
	"driver_phone" varchar(50),
	"loader_name" varchar(255),
	"loader_phone" varchar(50),
	"status" "order_truck_status" DEFAULT 'pending' NOT NULL,
	"security_entered_at" timestamp with time zone,
	"security_entered_by" integer,
	"loaded_at" timestamp with time zone,
	"loaded_by" integer,
	"security_exited_at" timestamp with time zone,
	"security_exited_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_trucks_quantity_check" CHECK ("order_trucks"."quantity" > 0 AND "order_trucks"."quantity" <= 60000)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "released_by" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "loading_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_by" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "order_truck_id" integer;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_customer_id_customers_id_fk" FOREIGN KEY ("actor_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_trucks" ADD CONSTRAINT "order_trucks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_trucks" ADD CONSTRAINT "order_trucks_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_trucks" ADD CONSTRAINT "order_trucks_security_entered_by_staff_id_fk" FOREIGN KEY ("security_entered_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_trucks" ADD CONSTRAINT "order_trucks_loaded_by_staff_id_fk" FOREIGN KEY ("loaded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_trucks" ADD CONSTRAINT "order_trucks_security_exited_by_staff_id_fk" FOREIGN KEY ("security_exited_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_staff_idx" ON "audit_logs" USING btree ("actor_staff_id","created_at") WHERE "audit_logs"."actor_staff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_trucks_order_idx" ON "order_trucks" USING btree ("order_id","truck_index");--> statement-breakpoint
CREATE INDEX "order_trucks_truck_idx" ON "order_trucks" USING btree ("truck_id") WHERE "order_trucks"."truck_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_trucks_status_idx" ON "order_trucks" USING btree ("status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_released_by_staff_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_staff_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_truck_id_order_trucks_id_fk" FOREIGN KEY ("order_truck_id") REFERENCES "public"."order_trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_order_truck_idx" ON "tickets" USING btree ("order_truck_id") WHERE "tickets"."order_truck_id" IS NOT NULL;