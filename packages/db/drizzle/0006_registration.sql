-- Sign-up per 04/07/12/17: three fields, phone verified before the store exists, agent code
-- checked, accepted terms recorded. Also the per-currency cash rounding step (09/10).

CREATE TYPE "public"."agent_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('registration');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"code" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"document" text NOT NULL,
	"document_version" text NOT NULL,
	"context" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "cash_rounding_steps" jsonb DEFAULT '{"SYP":1000,"USD":25}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_tenant_id_user_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_idx" ON "otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "legal_acceptances" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ─── Hand-written: access, functions and rules ───────────────────────────────

CREATE TRIGGER bump_row_version BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint

-- Append-only records: nobody changes or deletes them, the owner role included (a later purge role
-- for closed stores is the only exception, 09). TRUNCATE is not a row change and stays possible
-- for tests.
CREATE FUNCTION refuse_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'serva_purge' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON legal_acceptances FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint

GRANT SELECT, INSERT ON legal_acceptances TO serva_app;--> statement-breakpoint
-- agents and otp_challenges: no grant to serva_app; only the functions below reach them.

-- The agent behind a referral code, if that agent is active.
CREATE FUNCTION agent_find_by_code(p_code text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id FROM agents a WHERE a.code = upper(trim(p_code)) AND a.status = 'active'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_find_by_code(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_find_by_code(text) TO serva_app;--> statement-breakpoint

-- Stores a new code challenge. Sign-up challenges older than 24 hours are deleted on the way, so
-- an unconfirmed sign-up never holds anything for long.
CREATE FUNCTION otp_create(
  p_id uuid, p_purpose otp_purpose, p_phone text, p_code_hash text, p_payload jsonb,
  p_expires_at timestamptz, p_ip text, p_now timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM otp_challenges WHERE created_at < p_now - interval '24 hours';
  INSERT INTO otp_challenges (id, purpose, phone, code_hash, payload, expires_at, ip, created_at)
  VALUES (p_id, p_purpose, p_phone, p_code_hash, coalesce(p_payload, '{}'::jsonb), p_expires_at, p_ip, p_now);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION otp_create(uuid, otp_purpose, text, text, jsonb, timestamptz, text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION otp_create(uuid, otp_purpose, text, text, jsonb, timestamptz, text, timestamptz) TO serva_app;--> statement-breakpoint

-- Checks a code. ok: the challenge is used up and its phone and payload returned. A wrong code
-- counts an attempt; after p_max_attempts the challenge is locked and only a new code helps.
CREATE FUNCTION otp_consume(
  p_id uuid, p_purpose otp_purpose, p_code_hash text, p_max_attempts integer, p_now timestamptz
) RETURNS TABLE (status text, phone text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  c otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM otp_challenges o WHERE o.id = p_id AND o.purpose = p_purpose FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  IF c.expires_at <= p_now THEN
    DELETE FROM otp_challenges o WHERE o.id = p_id;
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  IF c.attempts >= p_max_attempts THEN
    RETURN QUERY SELECT 'locked'::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  IF c.code_hash <> p_code_hash THEN
    UPDATE otp_challenges o SET attempts = o.attempts + 1 WHERE o.id = p_id;
    RETURN QUERY SELECT (CASE WHEN c.attempts + 1 >= p_max_attempts THEN 'locked' ELSE 'invalid' END)::text,
                        NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  DELETE FROM otp_challenges o WHERE o.id = p_id;
  RETURN QUERY SELECT 'ok'::text, c.phone, c.payload;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION otp_consume(uuid, otp_purpose, text, integer, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION otp_consume(uuid, otp_purpose, text, integer, timestamptz) TO serva_app;--> statement-breakpoint

-- 30-day trial with every feature, no permanent free plan (owner decision, 07 and 09). Only if the
-- seeded plan still has its original 14 days; a value edited from the admin panel is kept.
UPDATE plans SET trial_days = 30 WHERE code = 'free' AND is_default AND trial_days = 14;
