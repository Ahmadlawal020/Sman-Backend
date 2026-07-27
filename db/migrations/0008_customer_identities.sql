CREATE TYPE "public"."customer_identity_provider" AS ENUM('email', 'google', 'apple', 'pin');--> statement-breakpoint
CREATE TABLE "customer_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"provider" "customer_identity_provider" NOT NULL,
	"provider_user_id" varchar(320) NOT NULL,
	"secret_hash" text,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"device_name" varchar(255) DEFAULT '',
	"user_agent" varchar(512) DEFAULT '',
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_passkeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"credential_id" varchar(512) NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"device_name" varchar(255) DEFAULT '',
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"purpose" varchar(20) NOT NULL,
	"challenge" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_trusted_devices" ADD CONSTRAINT "customer_trusted_devices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_passkeys" ADD CONSTRAINT "customer_passkeys_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_provider_uid_idx" ON "customer_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_customer_provider_idx" ON "customer_identities" USING btree ("customer_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_trusted_devices_token_idx" ON "customer_trusted_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_trusted_devices_customer_idx" ON "customer_trusted_devices" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_passkeys_credential_idx" ON "customer_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "customer_passkeys_customer_idx" ON "customer_passkeys" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_challenges_challenge_idx" ON "webauthn_challenges" USING btree ("challenge");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expires_idx" ON "webauthn_challenges" USING btree ("expires_at");