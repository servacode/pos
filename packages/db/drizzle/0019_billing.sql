-- Subscription billing and the platform panel (07 › فوترة الاشتراكات، لوحة مدير المنصة).
-- The store reads its invoices and payments and the platform's payment instructions; it opens an
-- invoice and reports a payment only through the two narrow functions below. Everything the
-- platform team does (stores, payments, plans, settings) goes through platform_* functions the API
-- calls behind the platform login; the store role never writes a subscription itself (0004).
CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"platform_user_id" uuid,
	"action" text NOT NULL,
	"store_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"payment_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"syp_per_usd" numeric DEFAULT '13000' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"usd_minor" bigint NOT NULL,
	"syp_minor" bigint NOT NULL,
	"syp_per_usd" numeric NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "subscription_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" text NOT NULL,
	"transaction_ref" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "subscription_payments_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "subscription_payments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_invoice_id_subscription_invoices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."subscription_invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscription_invoices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscription_payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
INSERT INTO "platform_settings" ("id", "payment_methods", "syp_per_usd") VALUES (1, '[
  {"key": "shamcash", "label": "شام كاش", "account": "يُضبط من لوحة المنصة", "beneficiary": "سيرفا", "instructions": "حوّل المبلغ واكتب رقم الفاتورة في الملاحظة، ثم اكتب رقم العملية هنا.", "enabled": true},
  {"key": "syriatel", "label": "سيريتل كاش", "account": "يُضبط من لوحة المنصة", "beneficiary": "سيرفا", "instructions": "حوّل المبلغ واكتب رقم الفاتورة في الملاحظة.", "enabled": true},
  {"key": "transfer", "label": "حوالة", "account": "يُضبط من لوحة المنصة", "beneficiary": "سيرفا", "instructions": "أرسل الحوالة باسم المستفيد واكتب رقم الإشعار هنا.", "enabled": true}
]', 13000) ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Every store starts with a 30-day trial with everything (07 › الباقات), editable in the panel.
UPDATE "plans" SET "trial_days" = 30 WHERE "code" = 'free' AND "trial_days" = 14;--> statement-breakpoint
-- Prices of the paid plans (07 › الأسعار، قرار المالك: within its ranges), editable in the panel.
UPDATE "plans" SET "price_monthly_minor" = 1000, "price_yearly_minor" = 10000 WHERE "code" = 'basic' AND "price_monthly_minor" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "price_monthly_minor" = 2500, "price_yearly_minor" = 25000 WHERE "code" = 'pro' AND "price_monthly_minor" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "price_monthly_minor" = 5000, "price_yearly_minor" = 50000 WHERE "code" = 'enterprise' AND "price_monthly_minor" IS NULL;--> statement-breakpoint
GRANT SELECT ON "platform_settings", "subscription_invoices", "subscription_payments" TO serva_app;--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "platform_settings" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE SEQUENCE "subscription_invoice_seq";--> statement-breakpoint
CREATE SEQUENCE "subscription_payment_seq";--> statement-breakpoint

-- Opens (or finds) the store's invoice for a plan and cycle, priced from the plan and the week's rate.
CREATE FUNCTION subscription_invoice_open(p_plan_code text, p_cycle billing_cycle, p_now timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_plan plans%ROWTYPE;
  v_rate numeric;
  v_usd bigint;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'subscription_invoice_open: no store selected' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_plan FROM plans WHERE code = p_plan_code AND is_active AND NOT is_free;
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_invoice_open: unknown plan' USING ERRCODE = '22023'; END IF;
  v_usd := CASE WHEN p_cycle = 'yearly' THEN v_plan.price_yearly_minor ELSE v_plan.price_monthly_minor END;
  IF v_usd IS NULL OR v_usd <= 0 THEN RAISE EXCEPTION 'subscription_invoice_open: the plan has no price' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_id FROM subscription_invoices
  WHERE tenant_id = v_tenant AND plan_id = v_plan.id AND billing_cycle = p_cycle AND status = 'open'
    AND created_at > p_now - interval '7 days';
  IF FOUND THEN RETURN v_id; END IF;
  SELECT syp_per_usd INTO v_rate FROM platform_settings WHERE id = 1;
  INSERT INTO subscription_invoices (tenant_id, number, plan_id, billing_cycle, usd_minor, syp_minor, syp_per_usd, created_at)
  VALUES (v_tenant,
          'SUB-' || to_char(p_now, 'YYYY') || '-' || lpad(nextval('subscription_invoice_seq')::text, 6, '0'),
          v_plan.id, p_cycle, v_usd,
          -- Pounds rounded up to a whole 1,000 (an easy number to transfer)
          ceil(v_usd * v_rate / 100000.0) * 100000,
          v_rate, p_now)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION subscription_invoice_open(text, billing_cycle, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION subscription_invoice_open(text, billing_cycle, timestamptz) TO serva_app;--> statement-breakpoint

-- Reports a payment for an open invoice. The store keeps working for 72 hours while it waits
-- (07 › تفعيل مؤقت): once per invoice, and never for a store whose payment was refused before.
CREATE FUNCTION subscription_payment_submit(p_invoice uuid, p_method text, p_ref text, p_amount bigint, p_currency text, p_user uuid, p_now timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'subscription_payment_submit: no store selected' USING ERRCODE = '42501'; END IF;
  IF p_now > now() + interval '1 day' THEN RAISE EXCEPTION 'subscription_payment_submit: time is in the future' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM subscription_invoices WHERE tenant_id = v_tenant AND id = p_invoice AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'subscription_payment_submit: no open invoice' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM subscription_payments WHERE tenant_id = v_tenant AND invoice_id = p_invoice AND status = 'pending') THEN
    RAISE EXCEPTION 'subscription_payment_submit: a payment is already waiting' USING ERRCODE = '23505';
  END IF;
  INSERT INTO subscription_payments (tenant_id, number, invoice_id, method, transaction_ref, amount_minor, currency, submitted_by, submitted_at)
  VALUES (v_tenant, 'SBP-' || to_char(p_now, 'YYYY') || '-' || lpad(nextval('subscription_payment_seq')::text, 6, '0'),
          p_invoice, p_method, p_ref, p_amount, p_currency, p_user, p_now)
  RETURNING id INTO v_id;
  IF NOT EXISTS (SELECT 1 FROM subscription_payments WHERE tenant_id = v_tenant AND status = 'rejected') THEN
    UPDATE subscriptions SET grace_ends_at = greatest(coalesce(grace_ends_at, p_now), p_now + interval '72 hours')
    WHERE tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION subscription_payment_submit(uuid, text, text, bigint, text, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION subscription_payment_submit(uuid, text, text, bigint, text, uuid, timestamptz) TO serva_app;--> statement-breakpoint

-- ─── The platform panel ──────────────────────────────────────────────────────
-- Called by the API only behind the platform login (its own token realm); each writes its
-- platform_audit_logs row.

CREATE FUNCTION platform_user_for_login(p_email text)
RETURNS TABLE (id uuid, full_name text, password_hash text, role platform_role, status user_status)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT id, full_name, password_hash, role, status FROM platform_users WHERE email = lower(p_email) $$;--> statement-breakpoint

CREATE FUNCTION platform_stores()
RETURNS TABLE (tenant_id uuid, name text, store_code text, owner_phone text, created_at timestamptz,
               tenant_status tenant_status, plan_code text, plan_name text, status subscription_status,
               billing_cycle billing_cycle, trial_ends_at timestamptz, current_period_end timestamptz,
               grace_ends_at timestamptz, pending_payments bigint, last_sale date)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.name, t.store_code,
         (SELECT u.phone FROM users u JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id
            JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
          WHERE u.tenant_id = t.id AND r.key = 'owner' ORDER BY u.created_at LIMIT 1),
         t.created_at, t.status, p.code, p.name, s.status, s.billing_cycle, s.trial_ends_at,
         s.current_period_end, s.grace_ends_at,
         (SELECT count(*) FROM subscription_payments sp WHERE sp.tenant_id = t.id AND sp.status = 'pending'),
         (SELECT max(i.business_date) FROM invoices i WHERE i.tenant_id = t.id)
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id
  LEFT JOIN plans p ON p.id = s.plan_id
  ORDER BY t.created_at DESC
$$;--> statement-breakpoint

CREATE FUNCTION platform_payments(p_status text)
RETURNS TABLE (id uuid, tenant_id uuid, store_name text, number text, invoice_number text, plan_name text,
               billing_cycle billing_cycle, method text, transaction_ref text, amount_minor bigint, currency text,
               invoice_usd_minor bigint, invoice_syp_minor bigint, status text, submitted_at timestamptz, reason text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT sp.id, sp.tenant_id, t.name, sp.number, si.number, p.name, si.billing_cycle, sp.method, sp.transaction_ref,
         sp.amount_minor, sp.currency, si.usd_minor, si.syp_minor, sp.status, sp.submitted_at, sp.reason
  FROM subscription_payments sp
  JOIN subscription_invoices si ON si.tenant_id = sp.tenant_id AND si.id = sp.invoice_id
  JOIN tenants t ON t.id = sp.tenant_id
  JOIN plans p ON p.id = si.plan_id
  WHERE p_status IS NULL OR sp.status = p_status
  ORDER BY sp.submitted_at DESC
  LIMIT 500
$$;--> statement-breakpoint

-- Confirms or refuses a reported payment. Confirming pays its invoice and moves the subscription
-- to that plan, active, for one more month or year from the later of now and its current end.
CREATE FUNCTION platform_payment_decide(p_payment uuid, p_admin uuid, p_confirm boolean, p_reason text, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay subscription_payments%ROWTYPE;
  v_inv subscription_invoices%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_start timestamptz;
BEGIN
  SELECT * INTO v_pay FROM subscription_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND OR v_pay.status <> 'pending' THEN
    RAISE EXCEPTION 'platform_payment_decide: no pending payment' USING ERRCODE = '22023';
  END IF;
  UPDATE subscription_payments SET status = CASE WHEN p_confirm THEN 'confirmed' ELSE 'rejected' END,
         decided_by = p_admin, decided_at = p_now, reason = p_reason
  WHERE id = p_payment;
  IF p_confirm THEN
    SELECT * INTO v_inv FROM subscription_invoices WHERE tenant_id = v_pay.tenant_id AND id = v_pay.invoice_id FOR UPDATE;
    UPDATE subscription_invoices SET status = 'paid', paid_at = p_now WHERE tenant_id = v_inv.tenant_id AND id = v_inv.id;
    SELECT * INTO v_sub FROM subscriptions WHERE tenant_id = v_pay.tenant_id FOR UPDATE;
    v_start := CASE WHEN v_sub.status = 'active' AND v_sub.current_period_end > p_now THEN v_sub.current_period_end ELSE p_now END;
    UPDATE subscriptions SET plan_id = v_inv.plan_id, status = 'active', billing_cycle = v_inv.billing_cycle,
           current_period_start = v_start,
           current_period_end = v_start + CASE WHEN v_inv.billing_cycle = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
           grace_ends_at = NULL, updated_at = p_now
    WHERE tenant_id = v_pay.tenant_id;
  ELSE
    UPDATE subscriptions SET grace_ends_at = NULL WHERE tenant_id = v_pay.tenant_id AND grace_ends_at > p_now;
  END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action, store_id, details)
  VALUES (p_admin, CASE WHEN p_confirm THEN 'payment.confirm' ELSE 'payment.reject' END, v_pay.tenant_id,
          jsonb_build_object('payment', v_pay.number, 'reason', p_reason));
END $$;--> statement-breakpoint

-- Sets a store's plan, state and end by hand (extend a trial, give a month, suspend).
CREATE FUNCTION platform_subscription_set(p_tenant uuid, p_plan_code text, p_status subscription_status, p_end timestamptz, p_admin uuid, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan uuid;
BEGIN
  SELECT id INTO v_plan FROM plans WHERE code = p_plan_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform_subscription_set: unknown plan' USING ERRCODE = '22023'; END IF;
  UPDATE subscriptions SET plan_id = v_plan, status = p_status,
         trial_ends_at = CASE WHEN p_status = 'trialing' THEN p_end ELSE trial_ends_at END,
         current_period_end = p_end, updated_at = p_now
  WHERE tenant_id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform_subscription_set: unknown store' USING ERRCODE = '22023'; END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action, store_id, details)
  VALUES (p_admin, 'subscription.set', p_tenant, jsonb_build_object('plan', p_plan_code, 'status', p_status, 'end', p_end));
END $$;--> statement-breakpoint

CREATE FUNCTION platform_plan_save(p_code text, p_name text, p_monthly bigint, p_yearly bigint, p_trial_days integer, p_active boolean, p_admin uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE plans SET name = p_name, price_monthly_minor = p_monthly, price_yearly_minor = p_yearly,
         trial_days = p_trial_days, is_active = p_active, updated_at = now()
  WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform_plan_save: unknown plan' USING ERRCODE = '22023'; END IF;
  INSERT INTO platform_audit_logs (platform_user_id, action, details)
  VALUES (p_admin, 'plan.save', jsonb_build_object('plan', p_code, 'monthly', p_monthly, 'yearly', p_yearly, 'trialDays', p_trial_days));
END $$;--> statement-breakpoint

CREATE FUNCTION platform_settings_save(p_methods jsonb, p_rate numeric, p_admin uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_rate IS NULL OR p_rate <= 0 THEN RAISE EXCEPTION 'platform_settings_save: rate must be positive' USING ERRCODE = '22023'; END IF;
  UPDATE platform_settings SET payment_methods = p_methods, syp_per_usd = p_rate, updated_at = now() WHERE id = 1;
  INSERT INTO platform_audit_logs (platform_user_id, action, details)
  VALUES (p_admin, 'settings.save', jsonb_build_object('sypPerUsd', p_rate));
END $$;--> statement-breakpoint

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform_user_for_login(text)', 'platform_stores()', 'platform_payments(text)',
    'platform_payment_decide(uuid, uuid, boolean, text, timestamptz)',
    'platform_subscription_set(uuid, text, subscription_status, timestamptz, uuid, timestamptz)',
    'platform_plan_save(text, text, bigint, bigint, integer, boolean, uuid)',
    'platform_settings_save(jsonb, numeric, uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO serva_app', f);
  END LOOP;
END $$;
