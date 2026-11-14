ALTER TABLE "platform_settings" ADD COLUMN "legal" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- The defaults the draft texts shipped with; everything else is a blank the platform panel fills.
UPDATE "platform_settings" SET "legal" = '{"governingCity": "دمشق", "financialRetention": "عشر سنوات", "paymentTolerance": "1%", "aiProvider": "يُسمّى هنا قبل تفعيل المساعد الذكي", "reviewedByLawyer": false, "updatedAt": "2026-10-30"}'::jsonb WHERE "id" = 1;--> statement-breakpoint

-- Saves the company and legal details the public pages show, and audits which keys changed.
CREATE FUNCTION platform_legal_save(p_legal jsonb, p_admin uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb;
  v_changed jsonb;
BEGIN
  IF p_legal IS NULL OR jsonb_typeof(p_legal) <> 'object' THEN
    RAISE EXCEPTION 'platform_legal_save: details must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT legal INTO v_old FROM platform_settings WHERE id = 1;
  SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO v_changed
  FROM (SELECT k FROM jsonb_object_keys(p_legal || coalesce(v_old, '{}'::jsonb)) AS k
        WHERE (p_legal -> k) IS DISTINCT FROM (v_old -> k)) c;
  UPDATE platform_settings SET legal = p_legal, updated_at = now() WHERE id = 1;
  INSERT INTO platform_audit_logs (platform_user_id, action, details)
  VALUES (p_admin, 'legal.save', jsonb_build_object('changed', v_changed));
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_legal_save(jsonb, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_legal_save(jsonb, uuid) TO serva_app;
