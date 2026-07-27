CREATE TYPE "public"."fleet_entry_type" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TABLE "fleet_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"entry_type" "fleet_entry_type" NOT NULL,
	"category" varchar(100) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"entry_date" date NOT NULL,
	"description" text DEFAULT '',
	"entered_by" varchar(255) DEFAULT '',
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_ledger_amount_check" CHECK ("fleet_ledger_entries"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "fleet_ledger_entries" ADD CONSTRAINT "fleet_ledger_entries_truck_id_fleet_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."fleet_trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_ledger_entries" ADD CONSTRAINT "fleet_ledger_entries_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_ledger_truck_date_idx" ON "fleet_ledger_entries" USING btree ("truck_id","entry_date");--> statement-breakpoint
CREATE INDEX "fleet_ledger_category_idx" ON "fleet_ledger_entries" USING btree ("category");