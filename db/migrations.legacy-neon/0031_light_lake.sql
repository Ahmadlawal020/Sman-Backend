ALTER TABLE "trucks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "trucks" CASCADE;--> statement-breakpoint
ALTER TABLE "delivery_inventory" DROP CONSTRAINT IF EXISTS "delivery_inventory_truck_id_trucks_id_fk";
--> statement-breakpoint
ALTER TABLE "driver_truck_history" DROP CONSTRAINT IF EXISTS "driver_truck_history_truck_id_trucks_id_fk";
--> statement-breakpoint
ALTER TABLE "order_trucks" DROP CONSTRAINT IF EXISTS "order_trucks_truck_id_trucks_id_fk";
--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "vin" varchar(50);--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "model" varchar(100);--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "truck_type" varchar(100);--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "fuel_level" integer DEFAULT 100;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "registration_expiry" date;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "next_service_mileage" integer;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "driver_id" integer;--> statement-breakpoint
ALTER TABLE "delivery_inventory" ADD CONSTRAINT "delivery_inventory_truck_id_fleet_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."fleet_trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_truck_history" ADD CONSTRAINT "driver_truck_history_truck_id_fleet_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."fleet_trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD CONSTRAINT "fleet_trucks_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_trucks" ADD CONSTRAINT "order_trucks_truck_id_fleet_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."fleet_trucks"("id") ON DELETE set null ON UPDATE no action;