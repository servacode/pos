-- Round 38 (dfix38): «تذكّر هالجهاز 30 يوم» for the agent's sign-in. The token a remembered device keeps carries
-- the agent's device_epoch; a suspension or a new password moves the number, so every remembered device of that agent
-- asks for the code again. A document, a posting or a store's books never see it.
ALTER TABLE "agents" ADD COLUMN "device_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- The number a remembered device must carry, for an agent who can still sign in (null: nobody, so no device is trusted)
CREATE FUNCTION agent_device_epoch(p_id uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT device_epoch FROM agents WHERE id = p_id AND status = 'active' AND password_hash IS NOT NULL $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_device_epoch(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_device_epoch(uuid) TO serva_app;--> statement-breakpoint

-- A new password (his own change) forgets his remembered devices
CREATE OR REPLACE FUNCTION agent_password_set(p_id uuid, p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE agents SET password_hash = p_hash, must_change_password = false, device_epoch = device_epoch + 1, updated_at = now()
  WHERE id = p_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_password_set: unknown agent' USING ERRCODE = '22023'; END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action, details)
  VALUES (NULL, 'agent.password', jsonb_build_object('agent', p_id));
END $$;--> statement-breakpoint

-- The owner's save: a suspension, or a new temporary password, forgets his remembered devices too
CREATE OR REPLACE FUNCTION platform_agent_save(
  p_id uuid, p_code text, p_name text, p_phone text, p_email text, p_region text, p_status agent_status,
  p_discount_bp integer, p_overrides jsonb, p_note text, p_password_hash text, p_admin uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_code text := upper(trim(p_code));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
BEGIN
  IF v_code = '' OR trim(p_name) = '' THEN RAISE EXCEPTION 'platform_agent_save: code and name are required' USING ERRCODE = '22023'; END IF;
  IF p_discount_bp < 0 OR p_discount_bp > 10000 THEN RAISE EXCEPTION 'platform_agent_save: discount out of range' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_overrides) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'platform_agent_save: prices must be an object' USING ERRCODE = '22023'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO agents (code, full_name, phone, email, region, status, discount_bp, price_overrides, note, password_hash, must_change_password)
    VALUES (v_code, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''), v_email, nullif(trim(coalesce(p_region, '')), ''),
            p_status, p_discount_bp, p_overrides, nullif(trim(coalesce(p_note, '')), ''), p_password_hash, p_password_hash IS NOT NULL)
    RETURNING id INTO v_id;
  ELSE
    UPDATE agents SET code = v_code, full_name = trim(p_name), phone = nullif(trim(coalesce(p_phone, '')), ''), email = v_email,
           region = nullif(trim(coalesce(p_region, '')), ''), status = p_status, discount_bp = p_discount_bp,
           price_overrides = p_overrides, note = nullif(trim(coalesce(p_note, '')), ''),
           password_hash = coalesce(p_password_hash, password_hash),
           must_change_password = CASE WHEN p_password_hash IS NOT NULL THEN true ELSE must_change_password END,
           device_epoch = CASE WHEN p_password_hash IS NOT NULL OR p_status = 'suspended' THEN device_epoch + 1 ELSE device_epoch END,
           updated_at = now()
    WHERE id = p_id RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'platform_agent_save: unknown agent' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action, details)
  VALUES (p_admin, CASE WHEN p_id IS NULL THEN 'agent.create' ELSE 'agent.save' END,
          jsonb_build_object('agent', v_id, 'code', v_code, 'status', p_status, 'discountBp', p_discount_bp,
                             'passwordSet', p_password_hash IS NOT NULL));
  RETURN v_id;
END $$;--> statement-breakpoint

-- Round 38 (dfix38): a rep's phone lists only the people the server lets in (its van's rep, the managers, the owner),
-- through the pull scope of users and user_roles (services/sync-pull.ts). A phone that already holds the whole staff
-- list downloads those two sets again at its next pull, so the old list goes.
UPDATE "devices"
   SET "resync_sets" = (SELECT coalesce(array_agg(DISTINCT s), '{}') FROM unnest("resync_sets" || ARRAY['users', 'user_roles']::text[]) s)
 WHERE "kind" = 'rep_phone' AND "revoked_at" IS NULL;
