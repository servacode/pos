ALTER TABLE "transfers" ADD COLUMN "in_transit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "transfer_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_transfer_mode_check" CHECK ("transfer_mode" IN ('auto', 'instant', 'transit'));--> statement-breakpoint
CREATE TABLE "transfer_receipts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"lines" jsonb NOT NULL,
	"short_pieces" bigint DEFAULT 0 NOT NULL,
	"short_value_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"stocktake_id" uuid,
	"received_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_receipts_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "transfer_receipts_transfer_unique" UNIQUE("tenant_id","transfer_id")
);
--> statement-breakpoint
ALTER TABLE "transfer_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_tenant_id_transfer_id_transfers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","transfer_id") REFERENCES "public"."transfers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transfer_receipts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Round 37, decision 16 (transfer «بالطريق»): the receiving branch's confirmation, written once, never changed.
GRANT SELECT, INSERT ON "transfer_receipts" TO serva_app;

--> statement-breakpoint
-- A serial number on its way between branches waits as in_transit; one that did not arrive is lost.
ALTER TABLE "serials" DROP CONSTRAINT "serials_status_check";--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_status_check" CHECK ("status" IN ('in_stock', 'sold', 'rented', 'returned', 'in_transit', 'lost'));
