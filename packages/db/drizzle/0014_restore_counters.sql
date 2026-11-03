-- Task M0-8: no number means two things after a restore.
--
-- A database restored from a backup has forgotten everything numbered after the backup: journal
-- entry numbers (already seen in a report or an export) and the codes of tills linked since, which
-- still hold their tokens and put that code in every document number they issue. Without this,
-- the next entry would take a number that once meant another entry, and the next till linked in
-- that branch would take a code a live till still uses: two different invoices, one number.
--
-- restore_counters_jump() is called by scripts/local/restore.sh after a restore, with the sync
-- epoch bump. It moves every store's entry numbering (each year it has, and the current year) and
-- every branch's device codes past a margin, and records each range it skipped in counter_jumps,
-- so the skipped numbers read as a declared jump and not as a lost entry. It posts nothing and
-- changes no posted entry. Running it twice jumps twice: harmless, only numbers are skipped.
CREATE TABLE "counter_jumps" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"counter" text NOT NULL,
	"year" integer,
	"branch_id" uuid,
	"from_number" integer NOT NULL,
	"to_number" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counter_jumps_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "counter_jumps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "counter_jumps" ADD CONSTRAINT "counter_jumps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counter_jumps_counter_idx" ON "counter_jumps" USING btree ("tenant_id","counter");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "counter_jumps" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "counter_jumps" ADD CONSTRAINT "counter_jumps_check" CHECK (
  "from_number" >= 1 AND "to_number" >= "from_number"
  AND (("counter" = 'journal' AND "year" BETWEEN 2000 AND 2999 AND "branch_id" IS NULL)
    OR ("counter" = 'device_code' AND "branch_id" IS NOT NULL AND "year" IS NULL AND "to_number" <= 999)));--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "counter_jumps" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
GRANT SELECT ON "counter_jumps" TO serva_app;--> statement-breakpoint
CREATE FUNCTION restore_counters_jump(entry_margin integer DEFAULT 10000, device_margin integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  stores integer;
BEGIN
  IF entry_margin < 1 OR device_margin < 1 THEN
    RAISE EXCEPTION 'restore_counters_jump: margins must be positive';
  END IF;

  -- Entry numbers. The current year too (in the store's time zone): entries lost after the
  -- backup may have opened it.
  INSERT INTO journal_sequences (tenant_id, year, last_number)
  SELECT t.id, extract(year FROM now() AT TIME ZONE t.timezone)::integer, 0 FROM tenants t
  ON CONFLICT (tenant_id, year) DO NOTHING;
  INSERT INTO counter_jumps (tenant_id, counter, year, from_number, to_number, reason)
  SELECT tenant_id, 'journal', year, last_number + 1, last_number + entry_margin, 'restore'
  FROM journal_sequences;
  UPDATE journal_sequences SET last_number = last_number + entry_margin;

  -- Device codes, per branch: past the highest code given or already skipped, up to 999.
  INSERT INTO counter_jumps (tenant_id, counter, branch_id, from_number, to_number, reason)
  SELECT b.tenant_id, 'device_code', b.id, top.n + 1, least(999, top.n + device_margin), 'restore'
  FROM branches b
  CROSS JOIN LATERAL (
    SELECT greatest(
      coalesce((SELECT max(d.code::integer) FROM devices d
                WHERE d.tenant_id = b.tenant_id AND d.branch_id = b.id AND d.code IS NOT NULL), 0),
      coalesce((SELECT max(j.to_number) FROM counter_jumps j
                WHERE j.tenant_id = b.tenant_id AND j.counter = 'device_code' AND j.branch_id = b.id), 0)
    ) AS n
  ) top
  WHERE top.n < 999;

  SELECT count(*) INTO stores FROM tenants;
  RETURN stores;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION restore_counters_jump(integer, integer) FROM PUBLIC;
