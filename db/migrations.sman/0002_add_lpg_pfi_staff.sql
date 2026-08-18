CREATE TABLE "sman"."lpg_station_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"lpg_station_id" bigint NOT NULL,
	"staff_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sman"."pfi_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"pfi_id" bigint NOT NULL,
	"staff_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sman"."lpg_station_staff" ADD CONSTRAINT "lpg_station_staff_lpg_station_id_consumer_lpgplant_id_fk" FOREIGN KEY ("lpg_station_id") REFERENCES "public"."consumer_lpgplant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."lpg_station_staff" ADD CONSTRAINT "lpg_station_staff_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."pfi_staff" ADD CONSTRAINT "pfi_staff_pfi_id_consumer_pfi_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."consumer_pfi"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sman"."pfi_staff" ADD CONSTRAINT "pfi_staff_staff_id_administration_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."administration_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lpg_station_staff_unique_idx" ON "sman"."lpg_station_staff" USING btree ("lpg_station_id","staff_id");--> statement-breakpoint
CREATE INDEX "lpg_station_staff_station_idx" ON "sman"."lpg_station_staff" USING btree ("lpg_station_id");--> statement-breakpoint
CREATE INDEX "lpg_station_staff_staff_idx" ON "sman"."lpg_station_staff" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pfi_staff_unique_idx" ON "sman"."pfi_staff" USING btree ("pfi_id","staff_id");--> statement-breakpoint
CREATE INDEX "pfi_staff_pfi_idx" ON "sman"."pfi_staff" USING btree ("pfi_id");--> statement-breakpoint
CREATE INDEX "pfi_staff_staff_idx" ON "sman"."pfi_staff" USING btree ("staff_id");