-- Rate-limit counters shared by every API instance, so limits survive restarts and do not
-- multiply with the number of instances. UNLOGGED: no WAL cost; losing counters in a crash is fine.
CREATE UNLOGGED TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);--> statement-breakpoint

-- Counts one hit on each key (fixed window of p_window_ms starting at the first hit) and returns
-- the counts. serva_app has no direct access to the table. Expired rows are swept now and then.
CREATE FUNCTION rate_limit_hit(p_keys text[], p_window_ms integer, p_now timestamptz)
RETURNS TABLE (key text, count integer, reset_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF random() < 0.01 THEN
    DELETE FROM rate_limits r WHERE r.reset_at < p_now - interval '1 hour';
  END IF;
  RETURN QUERY
  INSERT INTO rate_limits AS r (key, count, reset_at)
  SELECT k, 1, p_now + make_interval(secs => p_window_ms / 1000.0)
  FROM unnest(p_keys) AS k
  ON CONFLICT ON CONSTRAINT rate_limits_pkey DO UPDATE SET
    count = CASE WHEN r.reset_at <= p_now THEN 1 ELSE r.count + 1 END,
    reset_at = CASE WHEN r.reset_at <= p_now THEN EXCLUDED.reset_at ELSE r.reset_at END
  RETURNING r.key, r.count, r.reset_at;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION rate_limit_hit(text[], integer, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rate_limit_hit(text[], integer, timestamptz) TO serva_app;
