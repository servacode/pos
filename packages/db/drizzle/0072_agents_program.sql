CREATE TABLE "agent_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"balance_after_minor" bigint NOT NULL,
	"store_id" uuid,
	"plan_code" text,
	"billing_cycle" text,
	"list_price_minor" bigint,
	"request_key" text NOT NULL,
	"by_platform_user" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_ledger_request_unique" UNIQUE("agent_id","request_key")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "discount_bp" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "price_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "balance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "agent_ledger" ADD CONSTRAINT "agent_ledger_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_email_unique" UNIQUE("email");
--> statement-breakpoint
-- The agents program (07 › برنامج الوكلاء): platform side only. The agent's prepaid balance and its
-- ledger live in agents and agent_ledger, which no store ever reads or writes and which are never
-- part of a store's books. Everything goes through the functions below; each one that changes
-- something writes a platform_audit_logs row.
ALTER TABLE "agents" ADD CONSTRAINT "agents_balance_not_negative" CHECK ("balance_minor" >= 0);--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_discount_range" CHECK ("discount_bp" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "agent_ledger" ADD CONSTRAINT "agent_ledger_kind_known" CHECK ("kind" IN ('topup', 'adjust', 'activation'));--> statement-breakpoint
CREATE INDEX "agent_ledger_agent_idx" ON "agent_ledger" ("agent_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "tenants_agent_idx" ON "tenants" ("agent_id") WHERE "agent_id" IS NOT NULL;--> statement-breakpoint
REVOKE ALL ON "agent_ledger" FROM serva_app;--> statement-breakpoint
REVOKE ALL ON "agents" FROM serva_app;--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "agent_ledger" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint

-- Sign-in of an agent: his row by email.
CREATE FUNCTION agent_for_login(p_email text)
RETURNS TABLE (id uuid, full_name text, code text, password_hash text, status agent_status, must_change_password boolean)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT a.id, a.full_name, a.code, a.password_hash, a.status, a.must_change_password
      FROM agents a WHERE a.email = lower(trim(p_email)) AND a.password_hash IS NOT NULL $$;--> statement-breakpoint

-- The agent behind a token, if he is still active (a suspended agent's token stops working at once).
CREATE FUNCTION agent_session(p_id uuid)
RETURNS TABLE (id uuid, full_name text, code text, phone text, must_change_password boolean)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT a.id, a.full_name, a.code, a.phone, a.must_change_password
      FROM agents a WHERE a.id = p_id AND a.status = 'active' AND a.password_hash IS NOT NULL $$;--> statement-breakpoint

CREATE FUNCTION agent_password_hash(p_id uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT password_hash FROM agents WHERE id = p_id AND status = 'active' $$;--> statement-breakpoint

CREATE FUNCTION agent_password_set(p_id uuid, p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE agents SET password_hash = p_hash, must_change_password = false, updated_at = now() WHERE id = p_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_password_set: unknown agent' USING ERRCODE = '22023'; END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action, details)
  VALUES (NULL, 'agent.password', jsonb_build_object('agent', p_id));
END $$;--> statement-breakpoint

-- The owner's list: every agent with his balance and what his stores are doing.
CREATE FUNCTION platform_agents()
RETURNS TABLE (id uuid, code text, full_name text, phone text, email text, region text, status agent_status,
               discount_bp integer, price_overrides jsonb, balance_minor bigint, note text, has_login boolean,
               created_at timestamptz, stores bigint, paying bigint, trialing bigint)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.code, a.full_name, a.phone, a.email, a.region, a.status, a.discount_bp, a.price_overrides,
         a.balance_minor, a.note, a.password_hash IS NOT NULL, a.created_at,
         (SELECT count(*) FROM tenants t WHERE t.agent_id = a.id),
         (SELECT count(*) FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
           WHERE t.agent_id = a.id AND s.status = 'active'),
         (SELECT count(*) FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
           WHERE t.agent_id = a.id AND s.status = 'trialing')
  FROM agents a ORDER BY a.created_at DESC
$$;--> statement-breakpoint

-- Adds (id null) or edits an agent. The password hash is set only when given (then he must change it).
CREATE FUNCTION platform_agent_save(
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

-- Tops the balance up (plus) or deducts from it (minus, never below zero). One key, one effect:
-- repeating the key answers the first result and changes nothing.
CREATE FUNCTION platform_agent_balance_change(
  p_agent uuid, p_amount bigint, p_note text, p_key text, p_admin uuid, p_now timestamptz
) RETURNS TABLE (balance_minor bigint, replay boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance bigint;
  v_old agent_ledger%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'platform_agent_balance_change: amount must not be zero' USING ERRCODE = '22023'; END IF;
  IF p_key IS NULL OR length(trim(p_key)) < 8 THEN RAISE EXCEPTION 'platform_agent_balance_change: request key is required' USING ERRCODE = '22023'; END IF;
  SELECT a.balance_minor INTO v_balance FROM agents a WHERE a.id = p_agent FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform_agent_balance_change: unknown agent' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_old FROM agent_ledger l WHERE l.agent_id = p_agent AND l.request_key = p_key;
  IF FOUND THEN
    IF v_old.amount_minor <> p_amount OR v_old.kind = 'activation' THEN
      RAISE EXCEPTION 'platform_agent_balance_change: key reused' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_old.balance_after_minor, true;
    RETURN;
  END IF;
  IF v_balance + p_amount < 0 THEN RAISE EXCEPTION 'platform_agent_balance_change: insufficient balance' USING ERRCODE = '22023'; END IF;
  UPDATE agents SET balance_minor = agents.balance_minor + p_amount, updated_at = p_now WHERE agents.id = p_agent;
  INSERT INTO agent_ledger (agent_id, kind, amount_minor, balance_after_minor, request_key, by_platform_user, note, created_at)
  VALUES (p_agent, CASE WHEN p_amount > 0 THEN 'topup' ELSE 'adjust' END, p_amount, v_balance + p_amount, p_key, p_admin,
          nullif(trim(coalesce(p_note, '')), ''), p_now);
  INSERT INTO platform_audit_logs (platform_user_id, action, details)
  VALUES (p_admin, CASE WHEN p_amount > 0 THEN 'agent.topup' ELSE 'agent.deduct' END,
          jsonb_build_object('agent', p_agent, 'amountMinor', p_amount, 'balanceAfterMinor', v_balance + p_amount));
  RETURN QUERY SELECT v_balance + p_amount, false;
END $$;--> statement-breakpoint

CREATE FUNCTION agent_ledger_rows(p_agent uuid, p_limit integer)
RETURNS TABLE (id uuid, kind text, amount_minor bigint, balance_after_minor bigint, store_id uuid, store_name text,
               plan_code text, billing_cycle text, list_price_minor bigint, note text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.kind, l.amount_minor, l.balance_after_minor, l.store_id, t.name, l.plan_code, l.billing_cycle,
         l.list_price_minor, l.note, l.created_at
  FROM agent_ledger l LEFT JOIN tenants t ON t.id = l.store_id
  WHERE l.agent_id = p_agent ORDER BY l.created_at DESC, l.id DESC LIMIT least(greatest(p_limit, 1), 500)
$$;--> statement-breakpoint

-- An agent's stores and where each one stands: the subscription and when it ends, never the
-- store's business data. (The owner's phone is there so the agent can reach him.)
CREATE FUNCTION agent_stores(p_agent uuid)
RETURNS TABLE (tenant_id uuid, name text, store_code text, owner_phone text, created_at timestamptz,
               tenant_status tenant_status, plan_code text, plan_name text, status subscription_status,
               billing_cycle billing_cycle, trial_ends_at timestamptz, current_period_end timestamptz,
               grace_ends_at timestamptz, grace_days integer, updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.name, t.store_code,
         (SELECT u.phone FROM users u JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id
            JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
          WHERE u.tenant_id = t.id AND r.key = 'owner' ORDER BY u.created_at LIMIT 1),
         t.created_at, t.status, p.code, p.name, s.status, s.billing_cycle, s.trial_ends_at,
         s.current_period_end, s.grace_ends_at, p.grace_days, s.updated_at
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id
  LEFT JOIN plans p ON p.id = s.plan_id
  WHERE t.agent_id = p_agent
  ORDER BY t.created_at DESC
$$;--> statement-breakpoint

-- Which agent each store belongs to, for the owner's stores list.
CREATE FUNCTION platform_store_agents()
RETURNS TABLE (tenant_id uuid, agent_id uuid, agent_code text, agent_name text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT t.id, a.id, a.code, a.full_name FROM tenants t JOIN agents a ON a.id = t.agent_id $$;--> statement-breakpoint

-- The owner moves a store to another agent, or to nobody (the platform itself).
CREATE FUNCTION platform_agent_move_store(p_tenant uuid, p_to uuid, p_admin uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from uuid;
BEGIN
  SELECT agent_id INTO v_from FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform_agent_move_store: unknown store' USING ERRCODE = '22023'; END IF;
  IF p_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agents WHERE id = p_to) THEN
    RAISE EXCEPTION 'platform_agent_move_store: unknown agent' USING ERRCODE = '22023';
  END IF;
  UPDATE tenants SET agent_id = p_to, updated_at = now() WHERE id = p_tenant;
  INSERT INTO platform_audit_logs (platform_user_id, action, store_id, details)
  VALUES (p_admin, 'agent.move_store', p_tenant, jsonb_build_object('from', v_from, 'to', p_to));
END $$;--> statement-breakpoint

-- What a store's owner reads on his subscription page: who his agent is and how to reach him.
CREATE FUNCTION store_agent_info()
RETURNS TABLE (full_name text, phone text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT a.full_name, a.phone FROM tenants t JOIN agents a ON a.id = t.agent_id
      WHERE t.id = app_current_tenant() $$;--> statement-breakpoint

-- The agent pays for a store's paid plan from his prepaid balance at his wholesale price.
-- One transaction under the agent's row lock: the balance never goes below zero, a repeated key
-- answers the first result without charging again, and the subscription moves exactly the way a
-- confirmed payment moves it (platform_payment_decide): active on that plan, one more month or year
-- from the later of now and its current end. Only for his own store, only after its trial.
CREATE FUNCTION agent_activate(
  p_agent uuid, p_tenant uuid, p_plan text, p_cycle billing_cycle, p_key text, p_now timestamptz
) RETURNS TABLE (charged_minor bigint, balance_after_minor bigint, period_end timestamptz, replay boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent agents%ROWTYPE;
  v_old agent_ledger%ROWTYPE;
  v_plan plans%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_list bigint;
  v_price bigint;
  v_over text;
  v_start timestamptz;
  v_end timestamptz;
  v_balance bigint;
BEGIN
  SELECT * INTO v_agent FROM agents WHERE id = p_agent FOR UPDATE;
  IF NOT FOUND OR v_agent.status <> 'active' THEN RAISE EXCEPTION 'agent_activate: agent not active' USING ERRCODE = '42501'; END IF;
  IF p_key IS NULL OR length(trim(p_key)) < 8 THEN RAISE EXCEPTION 'agent_activate: request key is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_old FROM agent_ledger l WHERE l.agent_id = p_agent AND l.request_key = p_key;
  IF FOUND THEN
    IF v_old.kind <> 'activation' OR v_old.store_id IS DISTINCT FROM p_tenant OR v_old.plan_code IS DISTINCT FROM p_plan
       OR v_old.billing_cycle IS DISTINCT FROM p_cycle::text THEN
      RAISE EXCEPTION 'agent_activate: key reused' USING ERRCODE = '23505';
    END IF;
    SELECT s.current_period_end INTO v_end FROM subscriptions s WHERE s.tenant_id = p_tenant;
    RETURN QUERY SELECT -v_old.amount_minor, v_old.balance_after_minor, v_end, true;
    RETURN;
  END IF;
  PERFORM 1 FROM tenants WHERE id = p_tenant AND agent_id = p_agent;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_activate: not your store' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM tenants WHERE id = p_tenant AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_activate: store is suspended' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM plans WHERE code = p_plan AND is_active AND NOT is_free;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_activate: unknown plan' USING ERRCODE = '22023'; END IF;
  v_list := CASE WHEN p_cycle = 'yearly' THEN v_plan.price_yearly_minor ELSE v_plan.price_monthly_minor END;
  IF v_list IS NULL OR v_list <= 0 THEN RAISE EXCEPTION 'agent_activate: the plan has no price' USING ERRCODE = '22023'; END IF;
  v_over := v_agent.price_overrides -> p_plan ->> p_cycle::text;
  IF v_over IS NOT NULL AND v_over ~ '^[0-9]+$' THEN
    v_price := v_over::bigint;
  ELSE
    v_price := (v_list * (10000 - v_agent.discount_bp) + 5000) / 10000;
  END IF;
  IF v_price <= 0 THEN RAISE EXCEPTION 'agent_activate: the wholesale price is not set' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_activate: unknown store' USING ERRCODE = '22023'; END IF;
  IF v_sub.status = 'trialing' AND v_sub.trial_ends_at > p_now THEN
    RAISE EXCEPTION 'agent_activate: trial still running' USING ERRCODE = '22023';
  END IF;
  UPDATE agents SET balance_minor = agents.balance_minor - v_price, updated_at = p_now
  WHERE agents.id = p_agent AND agents.balance_minor >= v_price RETURNING agents.balance_minor INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_activate: insufficient balance' USING ERRCODE = '22023'; END IF;
  v_start := CASE WHEN v_sub.status = 'active' AND v_sub.current_period_end > p_now THEN v_sub.current_period_end ELSE p_now END;
  v_end := v_start + CASE WHEN p_cycle = 'yearly' THEN interval '1 year' ELSE interval '1 month' END;
  UPDATE subscriptions SET plan_id = v_plan.id, status = 'active', billing_cycle = p_cycle,
         current_period_start = v_start, current_period_end = v_end, grace_ends_at = NULL, updated_at = p_now
  WHERE tenant_id = p_tenant;
  INSERT INTO agent_ledger (agent_id, kind, amount_minor, balance_after_minor, store_id, plan_code, billing_cycle,
                            list_price_minor, request_key, created_at)
  VALUES (p_agent, 'activation', -v_price, v_balance, p_tenant, p_plan, p_cycle::text, v_list, p_key, p_now);
  INSERT INTO platform_audit_logs (platform_user_id, action, store_id, details)
  VALUES (NULL, 'agent.activate', p_tenant,
          jsonb_build_object('agent', p_agent, 'plan', p_plan, 'cycle', p_cycle, 'chargedMinor', v_price,
                             'listPriceMinor', v_list, 'balanceAfterMinor', v_balance, 'periodEnd', v_end));
  RETURN QUERY SELECT v_price, v_balance, v_end, false;
END $$;--> statement-breakpoint

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['agent_for_login(text)', 'agent_session(uuid)', 'agent_password_hash(uuid)', 'agent_password_set(uuid, text)',
    'platform_agents()',
    'platform_agent_save(uuid, text, text, text, text, text, agent_status, integer, jsonb, text, text, uuid)',
    'platform_agent_balance_change(uuid, bigint, text, text, uuid, timestamptz)',
    'agent_ledger_rows(uuid, integer)', 'agent_stores(uuid)', 'platform_store_agents()',
    'platform_agent_move_store(uuid, uuid, uuid)', 'store_agent_info()',
    'agent_activate(uuid, uuid, text, billing_cycle, text, timestamptz)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO serva_app', f);
  END LOOP;
END $$;
