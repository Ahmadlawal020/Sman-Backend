ALTER TABLE "products" ADD COLUMN "product_type" varchar(50) DEFAULT 'soroman' NOT NULL;--> statement-breakpoint
CREATE INDEX "products_type_idx" ON "products" USING btree ("product_type");
