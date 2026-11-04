-- Alteration tickets (03 › الألبسة: التعديل والتقصير): a piece left at the till to be altered, numbered
-- per store, followed until collected. The fee is sold at the till as a service; nothing posts here.
CREATE TABLE "alteration_tickets" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"item" text NOT NULL,
	"work" text NOT NULL,
	"currency" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"due_date" date NOT NULL,
	"note" text,
	"ready_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alteration_tickets_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "alteration_tickets_seq_unique" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
ALTER TABLE "alteration_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alteration_tickets" ADD CONSTRAINT "alteration_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alteration_tickets" ADD CONSTRAINT "alteration_tickets_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alteration_tickets_status_idx" ON "alteration_tickets" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "alteration_tickets" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());;--> statement-breakpoint
ALTER TABLE "alteration_tickets" ADD CONSTRAINT "alteration_tickets_status_check" CHECK (status IN ('received', 'ready', 'delivered'));--> statement-breakpoint
ALTER TABLE "alteration_tickets" ADD CONSTRAINT "alteration_tickets_price_check" CHECK (price_minor >= 0);--> statement-breakpoint
ALTER TABLE "alteration_tickets" ADD CONSTRAINT "alteration_tickets_number_unique" UNIQUE ("tenant_id", "number");--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "alteration_tickets" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "alteration_tickets" TO serva_app;
