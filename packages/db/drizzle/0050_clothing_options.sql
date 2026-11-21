ALTER TABLE "products" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "catalog_options" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "commission_bp" integer;--> statement-breakpoint
-- «تقصير» (03 › الملابس: التعديل والتقصير): the service item an alteration is billed with. Every store
-- of the clothing type that has no live service named «تقصير» gets one: a service on the till at
-- price 0 (the cashier types the real price). Idempotent: a store that has one is skipped, so
-- running it twice makes nothing new. New clothing stores and stores changing their business type
-- get the same item from the API (services/catalog-defaults.ts).
DO $$
DECLARE
  t record;
  unit_id uuid;
  product_id uuid;
  variant_id uuid;
BEGIN
  FOR t IN
    SELECT tn.id AS tenant_id, ts.base_currency
      FROM tenants tn
      JOIN tenant_settings ts ON ts.tenant_id = tn.id
     WHERE 'clothing' = ANY (tn.sectors)
       AND NOT EXISTS (
         SELECT 1 FROM products p
          WHERE p.tenant_id = tn.id AND p.type = 'service' AND p.name_ar = 'تقصير' AND p.archived_at IS NULL
       )
  LOOP
    SELECT u.id INTO unit_id FROM units u WHERE u.tenant_id = t.tenant_id AND u.system_key = 'piece';
    IF unit_id IS NULL THEN CONTINUE; END IF;
    INSERT INTO products (tenant_id, name_ar, search_name, type, unit_id, sell_on_pos)
      VALUES (t.tenant_id, 'تقصير', 'تقصير', 'service', unit_id, true)
      RETURNING id INTO product_id;
    INSERT INTO variants (tenant_id, product_id, sort_order)
      VALUES (t.tenant_id, product_id, 0)
      RETURNING id INTO variant_id;
    INSERT INTO prices (tenant_id, id, currency, price_minor)
      VALUES (t.tenant_id, variant_id, t.base_currency, 0);
  END LOOP;
END $$;
