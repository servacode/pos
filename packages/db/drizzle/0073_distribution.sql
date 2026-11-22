CREATE TABLE "commission_plans" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"basis" text DEFAULT 'sales' NOT NULL,
	"mode" text DEFAULT 'flat' NOT NULL,
	"rate_bp" integer,
	"tiers" jsonb,
	"returns_effect" text DEFAULT 'deduct' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_plans_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "commission_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "no_sale_reasons" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "no_sale_reasons_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "no_sale_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "regions_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rep_days" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"shift_id" uuid,
	"opening_cash" jsonb,
	"load_transfer_id" uuid,
	"load_confirmed_at" timestamp with time zone,
	"unload_transfer_id" uuid,
	"stocktake_id" uuid,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rep_days_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "rep_days_rep_date_unique" UNIQUE("tenant_id","rep_id","business_date")
);
--> statement-breakpoint
ALTER TABLE "rep_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rep_settlements" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"rep_id" uuid NOT NULL,
	"rep_day_id" uuid,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_cash" jsonb,
	"counted_cash" jsonb,
	"cash_difference" jsonb,
	"cheques" jsonb,
	"goods_difference" jsonb,
	"treatment" text,
	"pending_docs" integer DEFAULT 0 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rep_settlements_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "rep_settlements_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "rep_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rep_targets" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"metric" text NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"target_value" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rep_targets_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "rep_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rep_visits" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rep_day_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"route_id" uuid,
	"off_route" boolean DEFAULT false NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"lat" double precision,
	"lng" double precision,
	"outcome" text DEFAULT 'none' NOT NULL,
	"no_sale_reason_id" uuid,
	"doc_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rep_visits_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "rep_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "route_customers" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"visit_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "route_customers_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "route_customers_unique" UNIQUE("tenant_id","route_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "route_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"region_id" uuid,
	"weekdays" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"rep_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "routes_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"warehouse_branch_id" uuid NOT NULL,
	"device_id" uuid,
	"rep_id" uuid,
	"customer_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"device_time" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_receipt_id" uuid,
	"delivery_date" date,
	"hold_until" timestamp with time zone,
	"note" text,
	"cancel_reason" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "sales_orders_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sales_orders_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_reps" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"van_branch_id" uuid,
	"device_id" uuid,
	"mode" text DEFAULT 'van' NOT NULL,
	"max_discount_bp" integer,
	"daily_credit_limit_minor" bigint,
	"commission_plan_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_reps_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sales_reps_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sales_reps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "kind" text DEFAULT 'store' NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "parent_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "vehicle_plate" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "region_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "approval_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "resync_sets" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "tiers" jsonb;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "free_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "free_qty" integer;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "customer_kinds" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "price_tiers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "rep_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "distribution" jsonb;--> statement-breakpoint
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_sale_reasons" ADD CONSTRAINT "no_sale_reasons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."regions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_days" ADD CONSTRAINT "rep_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_days" ADD CONSTRAINT "rep_days_tenant_id_rep_id_sales_reps_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_id") REFERENCES "public"."sales_reps"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_settlements" ADD CONSTRAINT "rep_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_settlements" ADD CONSTRAINT "rep_settlements_tenant_id_rep_id_sales_reps_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_id") REFERENCES "public"."sales_reps"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_settlements" ADD CONSTRAINT "rep_settlements_tenant_id_rep_day_id_rep_days_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_day_id") REFERENCES "public"."rep_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_settlements" ADD CONSTRAINT "rep_settlements_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_targets" ADD CONSTRAINT "rep_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_targets" ADD CONSTRAINT "rep_targets_tenant_id_rep_id_sales_reps_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_id") REFERENCES "public"."sales_reps"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_tenant_id_rep_day_id_rep_days_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_day_id") REFERENCES "public"."rep_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_tenant_id_rep_id_sales_reps_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_id") REFERENCES "public"."sales_reps"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_tenant_id_route_id_routes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","route_id") REFERENCES "public"."routes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_reason_fk" FOREIGN KEY ("tenant_id","no_sale_reason_id") REFERENCES "public"."no_sale_reasons"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_customers" ADD CONSTRAINT "route_customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_customers" ADD CONSTRAINT "route_customers_tenant_id_route_id_routes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","route_id") REFERENCES "public"."routes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_customers" ADD CONSTRAINT "route_customers_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_region_id_regions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","region_id") REFERENCES "public"."regions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_rep_id_sales_reps_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_id") REFERENCES "public"."sales_reps"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_rep_id_sales_reps_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rep_id") REFERENCES "public"."sales_reps"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_tenant_id_user_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_van_fk" FOREIGN KEY ("tenant_id","van_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_commission_fk" FOREIGN KEY ("tenant_id","commission_plan_id") REFERENCES "public"."commission_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_plans_name_unique" ON "commission_plans" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "no_sale_reasons_key_unique" ON "no_sale_reasons" USING btree ("tenant_id","key") WHERE "no_sale_reasons"."key" is not null;--> statement-breakpoint
CREATE INDEX "no_sale_reasons_change_xid_idx" ON "no_sale_reasons" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_name_unique" ON "regions" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "regions_change_xid_idx" ON "regions" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "rep_days_date_idx" ON "rep_days" USING btree ("tenant_id","business_date");--> statement-breakpoint
CREATE INDEX "rep_settlements_rep_idx" ON "rep_settlements" USING btree ("tenant_id","rep_id","business_date");--> statement-breakpoint
CREATE INDEX "rep_targets_rep_idx" ON "rep_targets" USING btree ("tenant_id","rep_id","period_start");--> statement-breakpoint
CREATE INDEX "rep_visits_day_idx" ON "rep_visits" USING btree ("tenant_id","rep_day_id","arrived_at");--> statement-breakpoint
CREATE INDEX "rep_visits_customer_idx" ON "rep_visits" USING btree ("tenant_id","customer_id","arrived_at");--> statement-breakpoint
CREATE INDEX "route_customers_customer_idx" ON "route_customers" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "route_customers_change_xid_idx" ON "route_customers" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_name_unique" ON "routes" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "routes_rep_idx" ON "routes" USING btree ("tenant_id","rep_id");--> statement-breakpoint
CREATE INDEX "routes_change_xid_idx" ON "routes" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "sales_orders_open_idx" ON "sales_orders" USING btree ("tenant_id","status","warehouse_branch_id");--> statement-breakpoint
CREATE INDEX "sales_orders_customer_idx" ON "sales_orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "sales_orders_change_xid_idx" ON "sales_orders" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_reps_van_unique" ON "sales_reps" USING btree ("tenant_id","van_branch_id") WHERE "sales_reps"."van_branch_id" is not null;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_fk" FOREIGN KEY ("tenant_id","parent_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_region_fk" FOREIGN KEY ("tenant_id","region_id") REFERENCES "public"."regions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_region_idx" ON "customers" USING btree ("tenant_id","region_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "commission_plans" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "no_sale_reasons" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "regions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rep_days" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rep_settlements" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rep_targets" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rep_visits" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "route_customers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "routes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_orders" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_reps" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- «المندوبون والتوزيع» (docs/specs/32-sales-reps.md): a van is a branch of kind 'van'; a customer may be
-- waiting for the supervisor's approval; a store may carry reps only when its plan allows it. Every
-- default below keeps today's behaviour: stores stay 'store', customers stay approved, no plan gets
-- reps except where the plan says so, and nothing existing changes its meaning.
ALTER TABLE "branches" ADD CONSTRAINT "branches_kind_check" CHECK ("kind" IN ('store', 'van'));--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_check" CHECK (("kind" = 'van' OR "parent_branch_id" IS NULL) AND "parent_branch_id" IS DISTINCT FROM "id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_approval_check" CHECK ("approval_status" IN ('approved', 'pending', 'rejected'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_position_check" CHECK (("lat" IS NULL OR "lat" BETWEEN -90 AND 90) AND ("lng" IS NULL OR "lng" BETWEEN -180 AND 180));--> statement-breakpoint
ALTER TABLE "promotions" DROP CONSTRAINT "promotions_kind_check";--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_kind_check" CHECK ("kind" IN ('percent', 'buy_get', 'tiered', 'free_item'));--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_price_tiers_check" CHECK ("price_tiers" <@ ARRAY['retail', 'wholesale']);--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_mode_check" CHECK ("mode" IN ('van', 'presale', 'both'));--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_status_check" CHECK ("status" IN ('active', 'stopped'));--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_limits_check" CHECK (("max_discount_bp" IS NULL OR "max_discount_bp" BETWEEN 0 AND 10000) AND ("daily_credit_limit_minor" IS NULL OR "daily_credit_limit_minor" >= 0));--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_weekdays_check" CHECK ("weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);--> statement-breakpoint
ALTER TABLE "route_customers" ADD CONSTRAINT "route_customers_order_check" CHECK ("visit_order" >= 0);--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_status_check" CHECK ("status" IN ('open', 'partial', 'delivered', 'cancelled', 'expired'));--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_amounts_check" CHECK ("total_minor" >= 0 AND "deposit_minor" >= 0 AND jsonb_typeof("lines") = 'array');--> statement-breakpoint
ALTER TABLE "rep_days" ADD CONSTRAINT "rep_days_status_check" CHECK ("status" IN ('open', 'closed'));--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_outcome_check" CHECK ("outcome" IN ('sale', 'order', 'collection', 'return', 'no_sale', 'none'));--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_position_check" CHECK (("lat" IS NULL OR "lat" BETWEEN -90 AND 90) AND ("lng" IS NULL OR "lng" BETWEEN -180 AND 180));--> statement-breakpoint
ALTER TABLE "rep_settlements" ADD CONSTRAINT "rep_settlements_status_check" CHECK ("status" IN ('draft', 'approved', 'cancelled'));--> statement-breakpoint
ALTER TABLE "rep_settlements" ADD CONSTRAINT "rep_settlements_treatment_check" CHECK ("treatment" IS NULL OR "treatment" IN ('rep_debt', 'shop_loss'));--> statement-breakpoint
ALTER TABLE "rep_targets" ADD CONSTRAINT "rep_targets_metric_check" CHECK ("metric" IN ('net_sales', 'collections', 'new_customers', 'qty'));--> statement-breakpoint
ALTER TABLE "rep_targets" ADD CONSTRAINT "rep_targets_scope_check" CHECK ("scope" IN ('all', 'product', 'category'));--> statement-breakpoint
ALTER TABLE "rep_targets" ADD CONSTRAINT "rep_targets_period_check" CHECK ("period_end" >= "period_start" AND "target_value" >= 0);--> statement-breakpoint
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_basis_check" CHECK ("basis" IN ('sales', 'collections'));--> statement-breakpoint
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_mode_check" CHECK ("mode" IN ('flat', 'tiered'));--> statement-breakpoint
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_effect_check" CHECK ("returns_effect" IN ('deduct', 'ignore') AND ("rate_bp" IS NULL OR "rate_bp" BETWEEN 0 AND 10000));--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "regions" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "sales_reps" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "routes" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "route_customers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "no_sale_reasons" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "sales_orders" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "rep_days" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "rep_settlements" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "rep_targets" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "commission_plans" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
-- The tables a later package will pull to the phones (regions, routes, route customers, the no-sale reasons, orders)
-- keep the pull watermark and leave a tombstone when a row is deleted, like every pulled table.
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "regions" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "regions" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('regions', 'id');--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "routes" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "routes" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('routes', 'id');--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "route_customers" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "route_customers" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('route_customers', 'id');--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "no_sale_reasons" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "no_sale_reasons" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('no_sale_reasons', 'id');--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "sales_orders" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "sales_orders" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('sales_orders', 'id');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "regions" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_reps" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "routes" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "route_customers" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "no_sale_reasons" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_orders" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rep_days" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rep_visits" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rep_settlements" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rep_targets" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "commission_plans" TO serva_app;--> statement-breakpoint
-- The plans: reps are off on the free and basic plans (0: the module is hidden), two on pro, any number on
-- enterprise (null). A plan made later without the key is hidden too. A price or limit set in the panel is kept.
UPDATE "plans" SET "limits" = "limits" || jsonb_build_object('reps', CASE "code" WHEN 'pro' THEN 2 WHEN 'enterprise' THEN NULL ELSE 0 END)
WHERE NOT ("limits" ? 'reps');--> statement-breakpoint
-- The permissions: the owner gets every new one; the manager every one but the live location (the owner's
-- alone, who may grant it). Same lists as OWNER_ONLY and DEFAULT_ROLES in packages/core/src/permissions.ts.
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['rep.sell', 'rep.order', 'rep.collect', 'rep.deliver', 'rep.settle', 'rep.track', 'rep.targets', 'routes.manage', 'sales_orders.manage']
WHERE "key" = 'owner' AND "is_system";--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['rep.sell', 'rep.order', 'rep.collect', 'rep.deliver', 'rep.settle', 'rep.targets', 'routes.manage', 'sales_orders.manage']
WHERE "key" = 'manager' AND "is_system";--> statement-breakpoint
-- Three roles for every store: the rep, the delivery driver and the sales supervisor (a store that made a role
-- with the same key keeps its own).
INSERT INTO "roles" ("tenant_id", "key", "name", "permissions", "max_discount_bp", "is_system")
SELECT "id", 'rep', 'مندوب',
  ARRAY['sale.create', 'sale.discount', 'sale.credit', 'sale.refund', 'receipt.create', 'shift.close_own', 'customers.view', 'rep.sell', 'rep.order', 'rep.collect'],
  500, true FROM "tenants"
ON CONFLICT ("tenant_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "roles" ("tenant_id", "key", "name", "permissions", "max_discount_bp", "is_system")
SELECT "id", 'driver', 'سائق توصيل',
  ARRAY['sale.create', 'receipt.create', 'shift.close_own', 'customers.view', 'rep.deliver'],
  0, true FROM "tenants"
ON CONFLICT ("tenant_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "roles" ("tenant_id", "key", "name", "permissions", "max_discount_bp", "is_system")
SELECT "id", 'sales_supervisor', 'مشرف مبيعات',
  ARRAY['customers.view', 'customers.manage', 'report.view', 'rep.settle', 'rep.targets', 'routes.manage', 'sales_orders.manage', 'rep.deliver'],
  1000, true FROM "tenants"
ON CONFLICT ("tenant_id", "key") DO NOTHING;--> statement-breakpoint
-- The reasons a visit ends without a sale, for every store (new stores get them when they register;
-- packages/core › DEFAULT_NO_SALE_REASONS has the same list).
INSERT INTO "no_sale_reasons" ("tenant_id", "key", "name", "sort_order")
SELECT t."id", r."key", r."name", r."sort_order" FROM "tenants" t CROSS JOIN (VALUES
  ('closed', 'المحل مغلق', 1),
  ('no_need', 'لا يحتاج بضاعة الآن', 2),
  ('has_stock', 'لديه مخزون كافٍ', 3),
  ('owner_absent', 'صاحب القرار غير موجود', 4),
  ('postponed', 'طلب الزيارة لاحقاً', 5),
  ('overdue', 'عليه ذمم متأخرة', 6),
  ('competitor', 'يشتري من منافس', 7),
  ('other', 'سبب آخر', 8)
) AS r ("key", "name", "sort_order")
ON CONFLICT DO NOTHING;
