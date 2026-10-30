-- Billing is not the store's to write. The store role (serva_app) could update its own
-- subscription (status 'active', period end in ten years) because RLS only checks the store.
-- Now: subscriptions are read-only for serva_app, the first trial is started by a narrow
-- SECURITY DEFINER function, and on tenants serva_app may write only the columns a store owns.

REVOKE INSERT, UPDATE, DELETE ON subscriptions FROM serva_app;--> statement-breakpoint

-- Insert stays (registration creates the row; RLS pins it to the new store's id). Update is limited
-- to what the store edits in its settings: not status, referral_code, country or ids.
REVOKE UPDATE ON tenants FROM serva_app;--> statement-breakpoint
GRANT UPDATE (name, legal_name, tax_number, timezone, sectors) ON tenants TO serva_app;--> statement-breakpoint

-- Starts the free trial of the store selected by withTenant(), once (subscriptions_tenant_unique),
-- on the default plan with that plan's trial length. p_now is the server's clock; it may not be in
-- the future, so a caller cannot push the trial end out.
CREATE FUNCTION subscription_start_trial(p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_plan plans%ROWTYPE;
  v_end timestamptz;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'subscription_start_trial: no store selected' USING ERRCODE = '42501';
  END IF;
  IF p_now > now() + interval '1 day' THEN
    RAISE EXCEPTION 'subscription_start_trial: start time is in the future' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM plans WHERE is_default AND is_active ORDER BY sort_order LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_start_trial: no default plan is configured';
  END IF;
  v_end := CASE WHEN v_plan.trial_days IS NULL THEN NULL ELSE p_now + make_interval(days => v_plan.trial_days) END;
  INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  VALUES (v_tenant, v_plan.id, 'trialing', v_end, p_now, v_end);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION subscription_start_trial(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION subscription_start_trial(timestamptz) TO serva_app;
