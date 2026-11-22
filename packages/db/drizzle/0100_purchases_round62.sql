-- Round 62 (purchases): a supplier invoice's due date, the paper's discount and charges (already spread into the line costs, kept to show), the supplier's payment days, and the photos of the paper invoice (a table beside the append-only purchases).
CREATE TABLE "purchase_attachments" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_attachments_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "purchase_attachments_upload_unique" UNIQUE("tenant_id","purchase_id","upload_id")
);
--> statement-breakpoint
ALTER TABLE "purchase_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "discount_minor" bigint;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "charges_minor" bigint;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "terms_days" integer;--> statement-breakpoint
ALTER TABLE "purchase_attachments" ADD CONSTRAINT "purchase_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_attachments" ADD CONSTRAINT "purchase_attachments_tenant_id_purchase_id_purchases_tenant_id_id_fk" FOREIGN KEY ("tenant_id","purchase_id") REFERENCES "public"."purchases"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_attachments" ADD CONSTRAINT "purchase_attachments_tenant_id_upload_id_uploads_tenant_id_id_fk" FOREIGN KEY ("tenant_id","upload_id") REFERENCES "public"."uploads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_attachments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "purchase_attachments" TO serva_app;
