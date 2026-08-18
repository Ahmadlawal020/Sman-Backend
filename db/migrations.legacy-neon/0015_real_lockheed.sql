ALTER TABLE "dangote_order_requests" ADD COLUMN "virtual_account_number" varchar(30) DEFAULT '';--> statement-breakpoint
ALTER TABLE "dangote_order_requests" ADD COLUMN "virtual_account_bank" varchar(100) DEFAULT '';--> statement-breakpoint
ALTER TABLE "dangote_order_requests" ADD COLUMN "virtual_account_name" varchar(255) DEFAULT '';