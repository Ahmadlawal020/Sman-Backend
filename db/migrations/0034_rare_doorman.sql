ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "company_name" varchar(255) DEFAULT '' NOT NULL;
