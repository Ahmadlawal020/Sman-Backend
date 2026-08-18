DROP INDEX "wa_messages_wamid_idx";--> statement-breakpoint
ALTER TABLE "wa_messages" ALTER COLUMN "wamid" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_wamid_idx" ON "wa_messages" USING btree ("wamid") WHERE "wa_messages"."wamid" IS NOT NULL;