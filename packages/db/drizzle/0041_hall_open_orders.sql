CREATE TABLE "kitchen_tickets" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"section" text NOT NULL,
	"table_name" text NOT NULL,
	"kind" text DEFAULT 'new' NOT NULL,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "kitchen_tickets_seq_unique" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "open_order_events" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_order_events_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "open_order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "open_order_lines" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"seat" integer,
	"section" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"ticket_id" uuid,
	"added_by" uuid,
	"sent_at" timestamp with time zone,
	"preparing_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"approved_by" uuid,
	"cancelled_after_send" boolean DEFAULT false NOT NULL,
	"cancel_stage" text,
	"kitchen_ack_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_order_lines_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "open_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "open_orders" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"guests" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" uuid,
	"device_id" uuid,
	"bill_requested_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"closed_ref" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_orders_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "open_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_tenant_id_order_id_open_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."open_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_order_events" ADD CONSTRAINT "open_order_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_order_events" ADD CONSTRAINT "open_order_events_tenant_id_order_id_open_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."open_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_order_lines" ADD CONSTRAINT "open_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_order_lines" ADD CONSTRAINT "open_order_lines_tenant_id_order_id_open_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."open_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_orders" ADD CONSTRAINT "open_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_orders" ADD CONSTRAINT "open_orders_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kitchen_tickets_branch_idx" ON "kitchen_tickets" USING btree ("tenant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "open_order_events_order_idx" ON "open_order_events" USING btree ("tenant_id","order_id","at");--> statement-breakpoint
CREATE INDEX "open_order_lines_order_idx" ON "open_order_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "open_order_lines_ticket_idx" ON "open_order_lines" USING btree ("tenant_id","ticket_id");--> statement-breakpoint
CREATE INDEX "open_order_lines_cancel_idx" ON "open_order_lines" USING btree ("tenant_id","cancelled_at") WHERE cancelled_after_send;--> statement-breakpoint
CREATE UNIQUE INDEX "open_orders_table_live_idx" ON "open_orders" USING btree ("tenant_id","branch_id","table_name") WHERE status <> 'closed';--> statement-breakpoint
CREATE INDEX "open_orders_branch_idx" ON "open_orders" USING btree ("tenant_id","branch_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kitchen_tickets" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "open_order_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "open_order_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "open_orders" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "open_orders" ADD CONSTRAINT "open_orders_status_check" CHECK (status IN ('open', 'bill_requested', 'closed'));--> statement-breakpoint
ALTER TABLE "open_orders" ADD CONSTRAINT "open_orders_closed_check" CHECK ((status = 'closed') = (closed_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE "open_order_lines" ADD CONSTRAINT "open_order_lines_status_check" CHECK (status IN ('new', 'sent', 'preparing', 'ready', 'served', 'cancelled'));--> statement-breakpoint
ALTER TABLE "open_order_lines" ADD CONSTRAINT "open_order_lines_qty_check" CHECK (qty > 0);--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_kind_check" CHECK (kind IN ('new', 'add'));--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "open_orders" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "open_order_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "open_orders" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "open_order_lines" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "kitchen_tickets" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "open_order_events" TO serva_app;--> statement-breakpoint
-- «وضع النادل» (03 › المطاعم): the permissions to take table orders and to approve a cancellation
-- after the kitchen go to every store's owner and manager; the waiter role is added to every store.
UPDATE "roles" SET "permissions" = array_append("permissions", 'hall.order')
WHERE "key" IN ('owner', 'manager') AND "is_system" AND NOT ('hall.order' = ANY ("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'hall.cancel_approve')
WHERE "key" IN ('owner', 'manager') AND "is_system" AND NOT ('hall.cancel_approve' = ANY ("permissions"));--> statement-breakpoint
INSERT INTO "roles" ("tenant_id", "key", "name", "permissions", "max_discount_bp", "is_system")
SELECT "id", 'waiter', 'نادل', ARRAY['hall.order'], 0, true FROM "tenants"
ON CONFLICT ("tenant_id", "key") DO NOTHING;
