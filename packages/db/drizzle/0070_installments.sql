CREATE TABLE "installment_payments" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"no" integer NOT NULL,
	"receipt_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"pay_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_payments_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "installment_payments_receipt_unique" UNIQUE("tenant_id","receipt_id","plan_id","no")
);
--> statement-breakpoint
ALTER TABLE "installment_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sale_id" uuid,
	"source" text DEFAULT 'sale' NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"down_payment_minor" bigint NOT NULL,
	"principal_minor" bigint NOT NULL,
	"markup_minor" bigint NOT NULL,
	"financed_minor" bigint NOT NULL,
	"markup_bp" integer DEFAULT 0 NOT NULL,
	"installments_count" integer NOT NULL,
	"frequency" text NOT NULL,
	"first_due_date" date NOT NULL,
	"borrower" jsonb,
	"guarantor" jsonb,
	"notes_mode" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "installment_plans_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "installment_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "installment_reminders" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"no" integer NOT NULL,
	"kind" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_reminders_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "installment_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "installments" (
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"no" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_pkey" PRIMARY KEY("tenant_id","plan_id","no")
);
--> statement-breakpoint
ALTER TABLE "installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "promissory_notes" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"no" integer,
	"customer_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"status_date" date,
	"protest_fee_minor" bigint DEFAULT 0 NOT NULL,
	"printed_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promissory_notes_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "promissory_notes_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "promissory_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "installments" jsonb;--> statement-breakpoint
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_tenant_id_plan_id_no_installments_tenant_id_plan_id_no_fk" FOREIGN KEY ("tenant_id","plan_id","no") REFERENCES "public"."installments"("tenant_id","plan_id","no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_reminders" ADD CONSTRAINT "installment_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_reminders" ADD CONSTRAINT "installment_reminders_tenant_id_plan_id_no_installments_tenant_id_plan_id_no_fk" FOREIGN KEY ("tenant_id","plan_id","no") REFERENCES "public"."installments"("tenant_id","plan_id","no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_tenant_id_plan_id_installment_plans_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."installment_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_tenant_id_plan_id_installment_plans_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."installment_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installment_payments_plan_idx" ON "installment_payments" USING btree ("tenant_id","plan_id","no");--> statement-breakpoint
CREATE INDEX "installment_plans_customer_idx" ON "installment_plans" USING btree ("tenant_id","customer_id","status");--> statement-breakpoint
CREATE INDEX "installment_reminders_idx" ON "installment_reminders" USING btree ("tenant_id","plan_id","no","sent_at");--> statement-breakpoint
CREATE INDEX "installments_due_idx" ON "installments" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX "promissory_notes_status_idx" ON "promissory_notes" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "installment_payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "installment_plans" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "installment_reminders" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "installments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "promissory_notes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_status_check" CHECK (status IN ('active', 'completed', 'cancelled', 'defaulted'));--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_source_check" CHECK (source IN ('sale', 'debt'));--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_frequency_check" CHECK (frequency IN ('monthly', 'biweekly', 'weekly', 'custom'));--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_notes_mode_check" CHECK (notes_mode IN ('none', 'each', 'single'));--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_amounts_check" CHECK (financed_minor > 0 AND down_payment_minor >= 0 AND markup_minor >= 0 AND financed_minor = principal_minor + markup_minor);--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_status_check" CHECK (status IN ('open', 'paid', 'cancelled'));--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_paid_check" CHECK (amount_minor > 0 AND paid_minor BETWEEN 0 AND amount_minor);--> statement-breakpoint
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_amount_check" CHECK (amount_minor > 0);--> statement-breakpoint
ALTER TABLE "installment_reminders" ADD CONSTRAINT "installment_reminders_kind_check" CHECK (kind IN ('before', 'due', 'late'));--> statement-breakpoint
ALTER TABLE "promissory_notes" ADD CONSTRAINT "promissory_notes_status_check" CHECK (status IN ('issued', 'paid', 'protested', 'cancelled'));--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "installment_plans" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "promissory_notes" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "installment_plans" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "installments" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "installment_payments" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "installment_reminders" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "promissory_notes" TO serva_app;--> statement-breakpoint
-- «الأقساط»: the permissions to see plans, sell on instalments and cancel a plan go to every store's owner and manager.
UPDATE "roles" SET "permissions" = array_append("permissions", 'installments.view')
WHERE "key" IN ('owner', 'manager') AND "is_system" AND NOT ('installments.view' = ANY ("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'installments.create')
WHERE "key" IN ('owner', 'manager') AND "is_system" AND NOT ('installments.create' = ANY ("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'installments.manage')
WHERE "key" IN ('owner', 'manager') AND "is_system" AND NOT ('installments.manage' = ANY ("permissions"));
