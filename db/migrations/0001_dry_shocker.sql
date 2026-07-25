ALTER TABLE "customers" ADD COLUMN "virtual_account_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "delivery_customers" ADD COLUMN "virtual_account_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "virtual_account_name" varchar(255) DEFAULT '';
