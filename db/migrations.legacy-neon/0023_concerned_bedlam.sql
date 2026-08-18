CREATE TABLE "lpg_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"address" text NOT NULL,
	"city" varchar(100) NOT NULL,
	"state" varchar(100) NOT NULL,
	"country" varchar(100) NOT NULL,
	"postcode" varchar(20) NOT NULL,
	"lpg_capacity_kg" integer NOT NULL,
	"status" "depot_status" DEFAULT 'Active' NOT NULL,
	"established_year" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lpg_stations_capacity_check" CHECK ("lpg_stations"."lpg_capacity_kg" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lpg_station_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"lpg_station_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pfis" ADD COLUMN "lpg_station_id" integer;--> statement-breakpoint
ALTER TABLE "lpg_station_staff" ADD CONSTRAINT "lpg_station_staff_lpg_station_id_lpg_stations_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."lpg_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lpg_station_staff" ADD CONSTRAINT "lpg_station_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lpg_stations_code_idx" ON "lpg_stations" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "lpg_station_staff_unique_idx" ON "lpg_station_staff" USING btree ("lpg_station_id","staff_id");--> statement-breakpoint
CREATE INDEX "lpg_station_staff_station_idx" ON "lpg_station_staff" USING btree ("lpg_station_id");--> statement-breakpoint
CREATE INDEX "lpg_station_staff_staff_idx" ON "lpg_station_staff" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "pfis" ADD CONSTRAINT "pfis_lpg_station_id_lpg_stations_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."lpg_stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pfis_lpg_station_idx" ON "pfis" USING btree ("lpg_station_id");