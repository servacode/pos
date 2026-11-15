-- The owner's «احذف من القائمة» sets hidden_at on a stopped device (a hide, never a delete); like the other
-- owner actions it goes through the API, which writes it as serva_app.
GRANT UPDATE ("hidden_at") ON "devices" TO serva_app;
