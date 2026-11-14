-- Batch rules default on for a medical-supplies store (autoBatch, blockNoBatch) and the no-valid-batch
-- block defaults on for a pharmacy too. The defaults are filled in when the settings are read and
-- pulled (services/store.ts, sync-pull.ts) for whatever the owner never saved, so no value is
-- written here. Linked tills pull the settings row again, so they enforce the new defaults at once.
UPDATE "tenant_settings" SET "updated_at" = now()
WHERE EXISTS (SELECT 1 FROM "tenants" t WHERE t.id = "tenant_settings".tenant_id
              AND t.sectors && ARRAY['pharmacy', 'medical_supplies']);
