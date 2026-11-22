ALTER TABLE "alteration_tickets" ADD COLUMN "deposit_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alteration_tickets" ADD COLUMN "deposit_voucher" text;