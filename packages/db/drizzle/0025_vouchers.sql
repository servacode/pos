-- Exchange vouchers (03 › الملابس: قسيمة الاستبدال): what a return gave as a voucher instead of
-- money, by its code (the return's number), and what sales have spent of it. Pulled by every till.
CREATE TABLE "vouchers" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"return_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"redeemed_minor" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "vouchers_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "vouchers_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "vouchers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vouchers_change_xid_idx" ON "vouchers" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vouchers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "vouchers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "vouchers" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "vouchers" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('vouchers', 'id');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "vouchers" TO serva_app;
