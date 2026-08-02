CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"pfi_id" integer,
	"is_system_category" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pfi_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"pfi_id" integer,
	"category_id" integer NOT NULL,
	"expense_date" timestamp with time zone DEFAULT now() NOT NULL,
	"vendor" varchar(255) DEFAULT '',
	"description" text DEFAULT '',
	"amount" numeric(15, 2) NOT NULL,
	"bank_paid_from" varchar(255) DEFAULT '',
	"entered_by" varchar(255) DEFAULT '',
	"recorded_by" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pfi_expenses_amount_check" CHECK ("pfi_expenses"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pfi_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"pfi_id" integer NOT NULL,
	"order_id" integer,
	"action" varchar(30) DEFAULT 'RELEASE' NOT NULL,
	"qty_litres" integer NOT NULL,
	"notes" text DEFAULT '',
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pfi_expense_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" integer,
	"action" varchar(20) NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb,
	"actor_id" integer,
	"actor_name" varchar(255) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pfis" ADD COLUMN "bl_qty_litres" integer;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD CONSTRAINT "pfi_expenses_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_movements" ADD CONSTRAINT "pfi_movements_pfi_id_pfis_id_fk" FOREIGN KEY ("pfi_id") REFERENCES "public"."pfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_movements" ADD CONSTRAINT "pfi_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_movements" ADD CONSTRAINT "pfi_movements_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expense_audits" ADD CONSTRAINT "pfi_expense_audits_expense_id_pfi_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."pfi_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pfi_expense_audits" ADD CONSTRAINT "pfi_expense_audits_actor_id_staff_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_idx" ON "expense_categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_pfi_idx" ON "expense_categories" USING btree ("pfi_id") WHERE "expense_categories"."pfi_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pfi_expenses_pfi_idx" ON "pfi_expenses" USING btree ("pfi_id");--> statement-breakpoint
CREATE INDEX "pfi_expenses_category_idx" ON "pfi_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "pfi_expenses_date_idx" ON "pfi_expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "pfi_expenses_live_idx" ON "pfi_expenses" USING btree ("pfi_id") WHERE "pfi_expenses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pfi_movements_order_action_idx" ON "pfi_movements" USING btree ("order_id","action");--> statement-breakpoint
CREATE INDEX "pfi_movements_pfi_idx" ON "pfi_movements" USING btree ("pfi_id");--> statement-breakpoint
CREATE INDEX "pfi_expense_audits_expense_idx" ON "pfi_expense_audits" USING btree ("expense_id");