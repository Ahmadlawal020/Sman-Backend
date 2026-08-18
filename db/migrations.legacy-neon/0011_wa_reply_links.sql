ALTER TABLE "wa_messages" ADD COLUMN "in_reply_to" integer;--> statement-breakpoint
CREATE INDEX "wa_messages_reply_to_idx" ON "wa_messages" USING btree ("in_reply_to");