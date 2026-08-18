CREATE TABLE "lpg_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lpg_station_id" integer NOT NULL,
	"price_per_kg" numeric(15, 2) NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lpg_price_history" ADD CONSTRAINT "lpg_price_history_lpg_station_id_lpg_stations_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."lpg_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lpg_price_history_station_idx" ON "lpg_price_history" USING btree ("lpg_station_id");