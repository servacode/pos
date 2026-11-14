ALTER TYPE "public"."otp_purpose" ADD VALUE IF NOT EXISTS 'password_reset';--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "totp_pending_enc" text;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Password recovery for store users (purpose password_reset in otp_challenges, same otp_* functions)
-- and two-factor sign-in for the platform team (TOTP). platform_users stays unreachable by the store
-- role; only the narrow functions below touch the new columns, each behind the platform login.

CREATE FUNCTION platform_user_security(p_id uuid)
RETURNS TABLE (id uuid, full_name text, password_hash text, role platform_role, status user_status,
               totp_secret_enc text, totp_enabled boolean, recovery_left integer, must_change_password boolean)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, full_name, password_hash, role, status, totp_secret_enc, totp_enabled_at IS NOT NULL,
         jsonb_array_length(recovery_code_hashes), must_change_password
  FROM platform_users WHERE id = p_id
$$;--> statement-breakpoint

-- Keeps a freshly generated secret aside until a code from the authenticator confirms it.
CREATE FUNCTION platform_totp_begin(p_id uuid, p_pending_enc text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users SET totp_pending_enc = p_pending_enc, updated_at = now()
  WHERE id = p_id AND status = 'active' AND totp_enabled_at IS NULL;
  RETURN FOUND;
END $$;--> statement-breakpoint

CREATE FUNCTION platform_totp_pending(p_id uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT totp_pending_enc FROM platform_users WHERE id = p_id AND totp_enabled_at IS NULL $$;--> statement-breakpoint

-- Switches two-factor on: the pending secret becomes the secret, the confirming step is spent, the
-- recovery code hashes are stored.
CREATE FUNCTION platform_totp_activate(p_id uuid, p_step bigint, p_recovery jsonb, p_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users
  SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_enabled_at = p_now,
      totp_last_step = p_step, recovery_code_hashes = p_recovery, updated_at = now()
  WHERE id = p_id AND status = 'active' AND totp_enabled_at IS NULL AND totp_pending_enc IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action) VALUES (p_id, 'user.2fa_enrol');
  RETURN true;
END $$;--> statement-breakpoint

-- One code, one use: true only when the step is newer than the last one accepted.
CREATE FUNCTION platform_totp_spend(p_id uuid, p_step bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users SET totp_last_step = p_step
  WHERE id = p_id AND totp_enabled_at IS NOT NULL AND (totp_last_step IS NULL OR totp_last_step < p_step);
  RETURN FOUND;
END $$;--> statement-breakpoint

-- Uses up one recovery code (by its hash); true when it was there.
CREATE FUNCTION platform_recovery_spend(p_id uuid, p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users
  SET recovery_code_hashes = recovery_code_hashes - p_hash, updated_at = now()
  WHERE id = p_id AND totp_enabled_at IS NOT NULL AND recovery_code_hashes ? p_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action) VALUES (p_id, 'user.2fa_recovery_used');
  RETURN true;
END $$;--> statement-breakpoint

CREATE FUNCTION platform_password_set(p_id uuid, p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users SET password_hash = p_hash, must_change_password = false, updated_at = now()
  WHERE id = p_id;
  INSERT INTO platform_audit_logs (platform_user_id, action) VALUES (p_id, 'user.password_change');
END $$;--> statement-breakpoint

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform_user_security(uuid)', 'platform_totp_begin(uuid, text)',
    'platform_totp_pending(uuid)', 'platform_totp_activate(uuid, bigint, jsonb, timestamptz)',
    'platform_totp_spend(uuid, bigint)', 'platform_recovery_spend(uuid, text)',
    'platform_password_set(uuid, text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO serva_app', f);
  END LOOP;
END $$;
