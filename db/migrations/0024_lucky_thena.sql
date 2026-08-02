CREATE TABLE "lpg_station_cylinders" (
	"id" serial PRIMARY KEY NOT NULL,
	"lpg_station_id" integer NOT NULL,
	"cylinder_size_kg" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lpg_station_cylinders_size_check" CHECK ("lpg_station_cylinders"."cylinder_size_kg" >= 1),
	CONSTRAINT "lpg_station_cylinders_qty_check" CHECK ("lpg_station_cylinders"."quantity" >= 1)
);
--> statement-breakpoint
ALTER TABLE "lpg_station_cylinders" ADD CONSTRAINT "lpg_station_cylinders_lpg_station_id_lpg_stations_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."lpg_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lpg_station_cylinders_station_idx" ON "lpg_station_cylinders" USING btree ("lpg_station_id");