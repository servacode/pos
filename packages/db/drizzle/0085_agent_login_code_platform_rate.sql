-- Round 37, decision 21 (the agent's second sign-in step): a code sent to his phone by the same one-time-code
-- mechanism as sign-up and password recovery. The new value is used by code only after this migration commits.
ALTER TYPE "public"."otp_purpose" ADD VALUE IF NOT EXISTS 'agent_login';--> statement-breakpoint
-- Round 37, decision 9 (the platform's pounds per dollar, in new pounds): 13,000 became 120. The default is for the
-- platform row of a NEW installation. A platform whose team never saved a rate keeps the untouched seed, so it
-- moves to 120 too; one whose team saved any rate (an audit row 'settings.save') keeps it. Subscription invoices
-- already issued carry their own rate and are never touched; no store's own books or exchange rate change.
ALTER TABLE "platform_settings" ALTER COLUMN "syp_per_usd" SET DEFAULT '120';--> statement-breakpoint
UPDATE "platform_settings" SET "syp_per_usd" = '120'
 WHERE "id" = 1 AND "syp_per_usd" = 13000
   AND NOT EXISTS (SELECT 1 FROM "platform_audit_logs" WHERE "action" = 'settings.save');
