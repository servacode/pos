-- Round 35 › D2: the sales supervisor may move cash (the manager's code for a rep's day-start float)
-- and approve stock counts and transfers (the evening settlement's van count and unloading transfer).
-- Same list as DEFAULT_ROLES in packages/core/src/permissions.ts (new stores get it when they register).
-- Every store's existing supervisor role gets the two permissions, without repeating one it already has.
UPDATE "roles"
SET "permissions" = "permissions" || ARRAY(
      SELECT p FROM unnest(ARRAY['cash.move', 'inventory.adjust']) AS p WHERE NOT (p = ANY ("permissions"))
    )
WHERE "key" = 'sales_supervisor' AND "is_system";
