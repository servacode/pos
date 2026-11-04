-- Messages to the store's customers (03 › الألبسة: رسائل للزبائن): each broadcast keeps its phones and
-- how far it got, sent one at a time; a customer can be marked «لا يريد رسائل».
CREATE TABLE "broadcasts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"text" text NOT NULL,
	"audience" jsonb NOT NULL,
	"phones" jsonb NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "broadcasts_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "no_messages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_status_idx" ON "broadcasts" USING btree ("status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "broadcasts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_status_check" CHECK (status IN ('sending', 'done'));--> statement-breakpoint
-- The broadcasts still sending, across stores, for the server to carry on after a restart
CREATE FUNCTION broadcasts_sending() RETURNS TABLE (tenant_id uuid, id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.tenant_id, b.id FROM broadcasts b WHERE b.status = 'sending' ORDER BY b.created_at
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION broadcasts_sending() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION broadcasts_sending() TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "broadcasts" TO serva_app;
