-- RBAC location/PFI scope (the delta only — 0044–0053 already landed the
-- finance tables and columns this squash originally re-created).

CREATE TABLE "pfi_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"pfi_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_page_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"route_path" varchar(100) NOT NULL,
	"allowed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "can_view_all_locations" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD COLUMN "depot_id" integer;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD COLUMN "pfi_id" integer;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "depot_id" integer;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "pfi_id" integer;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_payments" ADD CONSTRAINT "expected_payments_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_staff" ADD CONSTRAINT "pfi_staff_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_staff" ADD CONSTRAINT "pfi_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_page_overrides" ADD CONSTRAINT "staff_page_overrides_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pfi_staff_unique_idx" ON "pfi_staff" USING btree ("pfi_id","staff_id");--> statement-breakpoint
CREATE INDEX "pfi_staff_pfi_idx" ON "pfi_staff" USING btree ("pfi_id");--> statement-breakpoint
CREATE INDEX "pfi_staff_staff_idx" ON "pfi_staff" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_page_overrides_unique_idx" ON "staff_page_overrides" USING btree ("staff_id","route_path");--> statement-breakpoint
CREATE INDEX "staff_page_overrides_staff_idx" ON "staff_page_overrides" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;
