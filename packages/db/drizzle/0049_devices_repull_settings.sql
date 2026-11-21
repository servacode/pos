-- Linked tills pull the settings row again: 0045 added `till` and the business types (sectors) to
-- the settings pull, but a till that pulled before that never sees them until something changes
-- (the clothing return reasons and the return window read them). Touching every row moves its
-- change_xid, so each device downloads its store's settings once more. No value changes.
UPDATE "tenant_settings" SET "updated_at" = now();
