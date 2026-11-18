-- The route editor tells a rep's phone to download its sets again: the API writes devices.resync_sets as
-- serva_app and the next pull empties it (0073 added the column, without the column grant the other
-- device columns have).
GRANT UPDATE ("resync_sets") ON "devices" TO serva_app;
