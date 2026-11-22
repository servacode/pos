ALTER TABLE "tenant_settings" ADD COLUMN "till" jsonb;--> statement-breakpoint
-- The settings pull set shows the store's business types (sectors) from tenants too: a change there
-- touches the settings row, so devices pull it again and word their screens by it.
CREATE OR REPLACE FUNCTION tenant_settings_follow_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.name, NEW.tax_number, NEW.timezone, NEW.sectors) IS DISTINCT FROM (OLD.name, OLD.tax_number, OLD.timezone, OLD.sectors) THEN
    UPDATE tenant_settings SET updated_at = now() WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
