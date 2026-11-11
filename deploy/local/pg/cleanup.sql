-- Removes rows that can never be used again and would otherwise grow without limit. Run as a
-- superuser by scripts/local/cleanup.sh (pnpm local:cleanup), so row-level security does not hide
-- other stores' rows. No migration, and nothing a financial or audit table holds is touched.
--
-- Already cleaned by the API itself, so not here: rate-limit counters (swept inside rate_limit_hit
-- every ~100 calls), sign-up codes (otp_create drops those older than 24 h), snapshot files (swept
-- whenever a snapshot is built). Left alone on purpose: pin_attempts (one row per user and device),
-- audit_logs and sync_inbox (kept by design; old months are dropped as partitions).
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset footer off
SET lock_timeout = '10s';
SET statement_timeout = '10min';

-- Sign-in sessions: every refresh makes a new row and revokes the old one. A row is useless once
-- its refresh token expired or its 90-day session ended (isSessionLive needs both in the future),
-- and a replayed token that old is simply "unknown". A week of grace keeps recent history for support.
WITH gone AS (
  DELETE FROM sessions
  WHERE least(expires_at, absolute_expires_at) < now() - interval '7 days'
  RETURNING 1
)
SELECT 'sessions|' || count(*) FROM gone;

-- Pairing codes that expired without a device ever being linked
WITH gone AS (
  DELETE FROM device_pairings
  WHERE used_at IS NULL AND expires_at < now() - interval '7 days'
  RETURNING 1
)
SELECT 'device_pairings|' || count(*) FROM gone;

-- Sign-up and order codes: the API deletes after 24 h only when a new code is requested
WITH gone AS (
  DELETE FROM otp_challenges
  WHERE created_at < now() - interval '24 hours'
  RETURNING 1
)
SELECT 'otp_challenges|' || count(*) FROM gone;

-- Rate-limit counters (also swept by the API; an idle server never sweeps)
WITH gone AS (
  DELETE FROM rate_limits
  WHERE reset_at < now() - interval '1 hour'
  RETURNING 1
)
SELECT 'rate_limits|' || count(*) FROM gone;
