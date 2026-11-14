-- Two more default roles for every store: «محاسب» (reads the books and the reports, records expenses;
-- the hand-written entries stay the owner's) and «أمين مستودع» (receives purchases and counts stock).
-- Same permissions as DEFAULT_ROLES in packages/core/src/permissions.ts. Existing stores get them
-- here; a store that already made a role with the same key keeps its own.
INSERT INTO "roles" ("tenant_id", "key", "name", "permissions", "max_discount_bp", "is_system")
SELECT "id", 'accountant', 'محاسب',
  ARRAY['customers.view', 'report.view', 'reports.financial', 'accounting.view', 'expenses.manage', 'cost.view'],
  0, true FROM "tenants"
ON CONFLICT ("tenant_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "roles" ("tenant_id", "key", "name", "permissions", "max_discount_bp", "is_system")
SELECT "id", 'storekeeper', 'أمين مستودع',
  ARRAY['purchases.manage', 'inventory.adjust'],
  0, true FROM "tenants"
ON CONFLICT ("tenant_id", "key") DO NOTHING;
