CREATE TABLE "accounts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"parent_code" text,
	"name" text NOT NULL,
	"name_en" text,
	"type" text NOT NULL,
	"normal_side" text NOT NULL,
	"final_account" text NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"currency" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "accounts_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"year" integer NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"entry_date" date NOT NULL,
	"posting_date" date NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_number" text,
	"memo" text NOT NULL,
	"base_currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "journal_entries_number_unique" UNIQUE("tenant_id","year","seq"),
	CONSTRAINT "journal_entries_source_unique" UNIQUE("tenant_id","source_type","source_id","kind")
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"rate" jsonb,
	"branch_id" uuid,
	"shift_id" uuid,
	"party_type" text,
	"party_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "journal_lines_line_unique" UNIQUE("tenant_id","entry_id","line_no")
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_sequences" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_sequences_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "journal_sequences_year_unique" UNIQUE("tenant_id","year")
);
--> statement-breakpoint
ALTER TABLE "journal_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_inbox" ADD COLUMN "duplicate_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_inbox" ADD COLUMN "last_duplicate_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_fk" FOREIGN KEY ("tenant_id","parent_code") REFERENCES "public"."accounts"("tenant_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_entry_id_journal_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_account_id_accounts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_sequences" ADD CONSTRAINT "journal_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_shift_idx" ON "journal_lines" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_entries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_sequences" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ─── Hand-written: the chart, the guarantees of the ledger, grants and back-fill ─────────────
-- (10 › دليل الحسابات الافتراضي، القيود التلقائية، قواعد الضمان; 09 › المحاسبة)
--   * account_chart(): the whole chart of tab 10 with its numbering, in one place. Levels 1–2
--     (1 الأصول، 11 الأصول المتداولة…) are groups; the 49 accounts marked «كل متجر» are made for
--     every store by accounts_seed(), the optional modules' accounts by account_ensure() when
--     something first posts to them. The drawers (1110) and the safe (1120) have a sub-account per
--     currency (111001 pounds, 111002 dollars), so both are groups;
--   * journal_entries and journal_lines are append-only; an entry balances in the base currency
--     (checked after the statement that inserts its lines, and again at commit), never posts to a
--     group, and a single-currency account only takes its currency;
--   * entry numbers per store and year without gaps (journal_sequences, taken in the posting
--     transaction);
--   * sync_inbox counts the copies of a document received after the first (the evidence screen);
--   * report.view and accounting.view for the owners and managers of existing stores.

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_code_check" CHECK ("code" ~ '^[1-9][0-9]{0,5}$');--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_type_check" CHECK ("type" IN ('asset', 'liability', 'equity', 'revenue', 'expense'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_normal_side_check" CHECK ("normal_side" IN ('debit', 'credit'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_final_account_check" CHECK ("final_account" IN ('balance_sheet', 'trading', 'profit_loss'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_check" CHECK ("currency" IS NULL OR "currency" IN ('SYP', 'USD'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "journal_sequences" ADD CONSTRAINT "journal_sequences_check" CHECK ("year" BETWEEN 2000 AND 2999 AND "last_number" >= 0);--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_kind_check" CHECK ("kind" IN ('auto', 'manual', 'reversal'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'shift_close', 'cash_movement', 'manual', 'reversal'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_number_check" CHECK ("seq" > 0 AND "number" = "year"::text || '-' || lpad("seq"::text, 7, '0'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_total_check" CHECK ("total_minor" >= 0);--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_currency_check" CHECK ("base_currency" IN ('SYP', 'USD'));--> statement-breakpoint
-- One side per line, in the base currency; amount_minor is the line's own currency, signed like it.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_side_check" CHECK (
  "debit_minor" >= 0 AND "credit_minor" >= 0 AND ("debit_minor" = 0 OR "credit_minor" = 0)
  AND ("debit_minor" = 0 OR "amount_minor" > 0) AND ("credit_minor" = 0 OR "amount_minor" < 0)
  AND ("debit_minor" + "credit_minor" > 0 OR "amount_minor" <> 0));--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_currency_check" CHECK ("currency" IN ('SYP', 'USD'));--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_check" CHECK (("party_type" IS NULL) = ("party_id" IS NULL) AND coalesce("party_type", 'user') IN ('customer', 'user'));--> statement-breakpoint

-- ─── The chart of tab 10 ─────────────────────────────────────────────────────
-- code, parent, name, English name, type, normal side, final account (الحساب الختامي), group,
-- made for every store. Contra accounts keep their type and take the other side: 1290 and
-- 1591–1596 (credit), 3160, 4200 and 4300 (debit). 3900 must be zero at month end; it is
-- credit-normal, the side of most opening balances against it.
CREATE FUNCTION account_chart()
RETURNS TABLE (code text, parent_code text, name text, name_en text, type text, normal_side text,
               final_account text, is_group boolean, every_store boolean)
LANGUAGE sql IMMUTABLE
AS $$
  VALUES
    ('1', NULL, 'الأصول', 'Assets', 'asset', 'debit', 'balance_sheet', true, true),
    ('11', '1', 'الأصول المتداولة', 'Current assets', 'asset', 'debit', 'balance_sheet', true, true),
    ('15', '1', 'الأصول الثابتة', 'Fixed assets', 'asset', 'debit', 'balance_sheet', true, true),
    ('2', NULL, 'الخصوم', 'Liabilities', 'liability', 'credit', 'balance_sheet', true, true),
    ('21', '2', 'الخصوم المتداولة', 'Current liabilities', 'liability', 'credit', 'balance_sheet', true, true),
    ('27', '2', 'الخصوم طويلة الأجل', 'Long-term liabilities', 'liability', 'credit', 'balance_sheet', true, true),
    ('3', NULL, 'حقوق الملكية', 'Equity', 'equity', 'credit', 'balance_sheet', true, true),
    ('31', '3', 'رأس المال والاحتياطيات وجاري المالك', 'Capital, reserves and owner accounts', 'equity', 'credit', 'balance_sheet', true, true),
    ('39', '3', 'الحسابات الوسيطة', 'Clearing accounts', 'equity', 'credit', 'balance_sheet', true, true),
    ('4', NULL, 'الإيرادات', 'Revenue', 'revenue', 'credit', 'profit_loss', true, true),
    ('41', '4', 'المبيعات وإيرادات الخدمة', 'Sales and service revenue', 'revenue', 'credit', 'trading', true, true),
    ('49', '4', 'إيرادات أخرى', 'Other income', 'revenue', 'credit', 'profit_loss', true, true),
    ('5', NULL, 'الكلفة', 'Cost', 'expense', 'debit', 'trading', true, true),
    ('51', '5', 'كلفة البضاعة المباعة', 'Cost of goods sold', 'expense', 'debit', 'trading', true, true),
    ('6', NULL, 'المصروفات', 'Expenses', 'expense', 'debit', 'profit_loss', true, true),
    ('61', '6', 'المصروفات التشغيلية والإدارية', 'Operating and administrative expenses', 'expense', 'debit', 'profit_loss', true, true),
    ('62', '6', 'فروقات الصندوق والمخزون والتقريب', 'Cash, inventory and rounding differences', 'expense', 'debit', 'profit_loss', true, true),
    ('65', '6', 'فروقات الصرف', 'Exchange differences', 'expense', 'debit', 'profit_loss', true, true),
    ('66', '6', 'عمولات الوسطاء', 'Intermediary fees', 'expense', 'debit', 'profit_loss', true, true),
    ('67', '6', 'الولاء', 'Loyalty', 'expense', 'debit', 'profit_loss', true, true),
    ('68', '6', 'النزاعات والاحتيال', 'Disputes and fraud', 'expense', 'debit', 'profit_loss', true, true),
    ('69', '6', 'الديون المعدومة وضريبة الدخل', 'Bad debts and income tax', 'expense', 'debit', 'profit_loss', true, true),
    ('1110', '11', 'الصندوق (أدراج الكاشير)', 'Cash drawers', 'asset', 'debit', 'balance_sheet', true, true),
    ('1115', '11', 'العهد النقدية: المندوبون والسائقون', 'Cash with reps and drivers', 'asset', 'debit', 'balance_sheet', false, false),
    ('1120', '11', 'الخزنة', 'Safe', 'asset', 'debit', 'balance_sheet', true, true),
    ('1130', '11', 'البنك', 'Bank', 'asset', 'debit', 'balance_sheet', false, true),
    ('1140', '11', 'مستحقات البطاقات', 'Card receivables', 'asset', 'debit', 'balance_sheet', false, true),
    ('1145', '11', 'مدفوعات متنازع عليها', 'Disputed payments', 'asset', 'debit', 'balance_sheet', false, false),
    ('1150', '11', 'المحافظ الإلكترونية', 'E-wallets', 'asset', 'debit', 'balance_sheet', false, true),
    ('1160', '11', 'شيكات تحت التحصيل', 'Cheques under collection', 'asset', 'debit', 'balance_sheet', false, true),
    ('1162', '11', 'أوراق القبض', 'Notes receivable', 'asset', 'debit', 'balance_sheet', false, false),
    ('1170', '11', 'مستحقات قنوات البيع', 'Sales channel receivables', 'asset', 'debit', 'balance_sheet', false, false),
    ('1200', '11', 'الزبائن (المدينون)', 'Customers (receivables)', 'asset', 'debit', 'balance_sheet', false, true),
    ('1250', '11', 'ذمم وسلف الموظفين', 'Staff receivables and advances', 'asset', 'debit', 'balance_sheet', false, false),
    ('1290', '11', 'مخصص الديون المشكوك في تحصيلها', 'Allowance for doubtful debts', 'asset', 'credit', 'balance_sheet', false, true),
    ('1300', '11', 'المخزون', 'Inventory', 'asset', 'debit', 'balance_sheet', false, true),
    ('1310', '11', 'بضاعة في الطريق', 'Goods in transit', 'asset', 'debit', 'balance_sheet', false, false),
    ('1400', '11', 'ضريبة مدخلات قابلة للخصم', 'Deductible input tax', 'asset', 'debit', 'balance_sheet', false, false),
    ('1450', '11', 'مصروفات مدفوعة مقدماً', 'Prepaid expenses', 'asset', 'debit', 'balance_sheet', false, false),
    ('1460', '11', 'دفعات مقدّمة للموردين', 'Advances to suppliers', 'asset', 'debit', 'balance_sheet', false, true),
    ('1510', '15', 'الأثاث', 'Furniture', 'asset', 'debit', 'balance_sheet', false, false),
    ('1520', '15', 'الأجهزة', 'Equipment', 'asset', 'debit', 'balance_sheet', false, false),
    ('1530', '15', 'السيارات', 'Vehicles', 'asset', 'debit', 'balance_sheet', false, false),
    ('1540', '15', 'المباني', 'Buildings', 'asset', 'debit', 'balance_sheet', false, false),
    ('1550', '15', 'الأراضي', 'Land', 'asset', 'debit', 'balance_sheet', false, false),
    ('1560', '15', 'الآلات', 'Machinery', 'asset', 'debit', 'balance_sheet', false, false),
    ('1591', '15', 'مجمع اهتلاك وانخفاض الأثاث', 'Accumulated depreciation: furniture', 'asset', 'credit', 'balance_sheet', false, false),
    ('1592', '15', 'مجمع اهتلاك وانخفاض الأجهزة', 'Accumulated depreciation: equipment', 'asset', 'credit', 'balance_sheet', false, false),
    ('1593', '15', 'مجمع اهتلاك وانخفاض السيارات', 'Accumulated depreciation: vehicles', 'asset', 'credit', 'balance_sheet', false, false),
    ('1594', '15', 'مجمع اهتلاك وانخفاض المباني', 'Accumulated depreciation: buildings', 'asset', 'credit', 'balance_sheet', false, false),
    ('1595', '15', 'مجمع اهتلاك وانخفاض الأراضي', 'Accumulated depreciation: land', 'asset', 'credit', 'balance_sheet', false, false),
    ('1596', '15', 'مجمع اهتلاك وانخفاض الآلات', 'Accumulated depreciation: machinery', 'asset', 'credit', 'balance_sheet', false, false),
    ('1900', '11', 'جاري الفروع', 'Branch current accounts', 'asset', 'debit', 'balance_sheet', false, false),
    ('2100', '21', 'الموردون (الدائنون)', 'Suppliers (payables)', 'liability', 'credit', 'balance_sheet', false, true),
    ('2150', '21', 'شيكات مستحقة الدفع', 'Cheques payable', 'liability', 'credit', 'balance_sheet', false, true),
    ('2152', '21', 'أوراق الدفع', 'Notes payable', 'liability', 'credit', 'balance_sheet', false, false),
    ('2170', '21', 'تكاليف شراء مستحقة', 'Accrued purchase costs', 'liability', 'credit', 'balance_sheet', false, false),
    ('2200', '21', 'ضريبة مبيعات مستحقة (من نوع القيمة المضافة)', 'Sales tax payable (VAT type)', 'liability', 'credit', 'balance_sheet', false, false),
    ('2210', '21', 'رسم الإنفاق الاستهلاكي المستحق', 'Consumption spending tax payable', 'liability', 'credit', 'balance_sheet', false, false),
    ('2220', '21', 'رسم الطابع المستحق', 'Stamp duty payable', 'liability', 'credit', 'balance_sheet', false, false),
    ('2230', '21', 'ضريبة الدخل المستحقة', 'Income tax payable', 'liability', 'credit', 'balance_sheet', false, true),
    ('2300', '21', 'عربون ودفعات مقدّمة من الزبائن', 'Customer deposits and advances', 'liability', 'credit', 'balance_sheet', false, true),
    ('2310', '21', 'قسائم وبطاقات هدايا مباعة', 'Vouchers and gift cards sold', 'liability', 'credit', 'balance_sheet', false, false),
    ('2400', '21', 'التزامات نقاط الولاء', 'Loyalty points liability', 'liability', 'credit', 'balance_sheet', false, false),
    ('2500', '21', 'رواتب مستحقة الدفع', 'Salaries payable', 'liability', 'credit', 'balance_sheet', false, false),
    ('2510', '21', 'ضريبة رواتب مقتطعة', 'Payroll tax withheld', 'liability', 'credit', 'balance_sheet', false, false),
    ('2520', '21', 'تأمينات اجتماعية مستحقة', 'Social insurance payable', 'liability', 'credit', 'balance_sheet', false, false),
    ('2530', '21', 'مخصص نهاية الخدمة', 'End-of-service provision', 'liability', 'credit', 'balance_sheet', false, false),
    ('2540', '21', 'عمولات مستحقة للموظفين', 'Commissions payable to staff', 'liability', 'credit', 'balance_sheet', false, false),
    ('2550', '21', 'إكراميات ونسبة خدمة مستحقة للموظفين', 'Tips and service charge due to staff', 'liability', 'credit', 'balance_sheet', false, false),
    ('2600', '21', 'مصروفات مستحقة', 'Accrued expenses', 'liability', 'credit', 'balance_sheet', false, false),
    ('2700', '27', 'القروض', 'Loans', 'liability', 'credit', 'balance_sheet', false, false),
    ('3100', '31', 'رأس المال', 'Capital', 'equity', 'credit', 'balance_sheet', false, true),
    ('3150', '31', 'جاري المالك أو الشركاء', 'Owner or partners current account', 'equity', 'credit', 'balance_sheet', false, true),
    ('3160', '31', 'المسحوبات الشخصية', 'Personal drawings', 'equity', 'debit', 'balance_sheet', false, true),
    ('3200', '31', 'الأرباح المدوّرة', 'Retained earnings', 'equity', 'credit', 'balance_sheet', false, true),
    ('3300', '31', 'فائض إعادة التقييم', 'Revaluation surplus', 'equity', 'credit', 'balance_sheet', false, false),
    ('3400', '31', 'الاحتياطي القانوني', 'Legal reserve', 'equity', 'credit', 'balance_sheet', false, false),
    ('3900', '39', 'الأرصدة الافتتاحية', 'Opening balances', 'equity', 'credit', 'balance_sheet', false, true),
    ('4100', '41', 'المبيعات', 'Sales', 'revenue', 'credit', 'trading', false, true),
    ('4150', '41', 'إيرادات التوصيل والخدمة', 'Delivery and service revenue', 'revenue', 'credit', 'profit_loss', false, false),
    ('4200', '41', 'الحسميات الممنوحة', 'Discounts allowed', 'revenue', 'debit', 'trading', false, true),
    ('4300', '41', 'مردودات المبيعات', 'Sales returns', 'revenue', 'debit', 'trading', false, true),
    ('4900', '49', 'أرباح بيع الأصول', 'Gains on sale of assets', 'revenue', 'credit', 'profit_loss', false, false),
    ('4910', '49', 'الحسم المكتسب', 'Discounts received', 'revenue', 'credit', 'profit_loss', false, true),
    ('4920', '49', 'إيرادات متنوعة', 'Other income', 'revenue', 'credit', 'profit_loss', false, true),
    ('5100', '51', 'كلفة المبيعات', 'Cost of sales', 'expense', 'debit', 'trading', false, true),
    ('6100', '61', 'المصروفات التشغيلية', 'Operating expenses', 'expense', 'debit', 'profit_loss', true, true),
    ('6101', '6100', 'الإيجار', 'Rent', 'expense', 'debit', 'profit_loss', false, true),
    ('6102', '6100', 'الكهرباء والأمبيرات والمحروقات', 'Electricity, generators and fuel', 'expense', 'debit', 'profit_loss', false, true),
    ('6103', '6100', 'المياه', 'Water', 'expense', 'debit', 'profit_loss', false, true),
    ('6104', '6100', 'الهاتف والإنترنت', 'Phone and internet', 'expense', 'debit', 'profit_loss', false, true),
    ('6105', '6100', 'النقل والتوصيل', 'Transport and delivery', 'expense', 'debit', 'profit_loss', false, true),
    ('6106', '6100', 'الصيانة والإصلاح', 'Maintenance and repairs', 'expense', 'debit', 'profit_loss', false, true),
    ('6107', '6100', 'الدعاية والعينات والهدايا', 'Advertising, samples and gifts', 'expense', 'debit', 'profit_loss', false, true),
    ('6108', '6100', 'الضيافة والنظافة والمستهلكات', 'Hospitality, cleaning and consumables', 'expense', 'debit', 'profit_loss', false, true),
    ('6109', '6100', 'القرطاسية والمطبوعات', 'Stationery and printing', 'expense', 'debit', 'profit_loss', false, true),
    ('6110', '6100', 'الرواتب والأجور', 'Salaries and wages', 'expense', 'debit', 'profit_loss', false, true),
    ('6120', '6100', 'حصة صاحب العمل من التأمينات', 'Employer social insurance', 'expense', 'debit', 'profit_loss', false, false),
    ('6130', '6100', 'نهاية الخدمة والمكافآت', 'End of service and bonuses', 'expense', 'debit', 'profit_loss', false, false),
    ('6140', '6100', 'عمولات المبيعات', 'Sales commissions', 'expense', 'debit', 'profit_loss', false, false),
    ('6150', '6100', 'مصروف الاهتلاك', 'Depreciation expense', 'expense', 'debit', 'profit_loss', false, false),
    ('6160', '6100', 'خسائر الأصول وانخفاض قيمتها', 'Asset losses and impairment', 'expense', 'debit', 'profit_loss', false, false),
    ('6170', '6100', 'الرسوم والتراخيص', 'Fees and licences', 'expense', 'debit', 'profit_loss', false, true),
    ('6180', '6100', 'الأتعاب المهنية واشتراكات البرامج', 'Professional fees and software subscriptions', 'expense', 'debit', 'profit_loss', false, true),
    ('6190', '6100', 'مصاريف متنوعة', 'Miscellaneous expenses', 'expense', 'debit', 'profit_loss', false, true),
    ('6200', '62', 'عجز وزيادة الصندوق', 'Cash over and short', 'expense', 'debit', 'profit_loss', false, true),
    ('6300', '62', 'تلف وفقد المخزون', 'Inventory damage and loss', 'expense', 'debit', 'profit_loss', false, true),
    ('6400', '62', 'فروقات التقريب', 'Rounding differences', 'expense', 'debit', 'profit_loss', false, true),
    ('6500', '65', 'فروقات أسعار الصرف (القطع)', 'Exchange differences', 'expense', 'debit', 'profit_loss', true, true),
    ('6510', '6500', 'فروقات صرف محققة', 'Realised exchange differences', 'expense', 'debit', 'profit_loss', false, true),
    ('6520', '6500', 'فروقات صرف غير محققة', 'Unrealised exchange differences', 'expense', 'debit', 'profit_loss', false, true),
    ('6600', '66', 'عمولات البنوك والمحافظ والبطاقات', 'Bank, wallet and card fees', 'expense', 'debit', 'profit_loss', false, true),
    ('6610', '66', 'عمولات قنوات البيع', 'Sales channel commissions', 'expense', 'debit', 'profit_loss', false, false),
    ('6700', '67', 'كلفة برنامج الولاء', 'Loyalty programme cost', 'expense', 'debit', 'profit_loss', false, false),
    ('6800', '68', 'خسائر النزاعات والاحتيال', 'Dispute and fraud losses', 'expense', 'debit', 'profit_loss', false, false),
    ('6910', '69', 'الديون المعدومة', 'Bad debts', 'expense', 'debit', 'profit_loss', false, true),
    ('6920', '69', 'مصروف مخصص الديون', 'Doubtful debts expense', 'expense', 'debit', 'profit_loss', false, true),
    ('6950', '69', 'ضريبة الدخل والرسوم الملحقة بها', 'Income tax and related charges', 'expense', 'debit', 'profit_loss', false, true)

$$;--> statement-breakpoint

-- The account of the chart with this code, made for the store if it does not have it yet (an
-- optional module's account the first time something posts to it). Runs as the caller: the
-- store's own row-level security applies.
CREATE FUNCTION account_ensure(p_tenant uuid, p_code text) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_parent text;
BEGIN
  SELECT a.id INTO v_id FROM accounts a WHERE a.tenant_id = p_tenant AND a.code = p_code;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  SELECT c.parent_code INTO v_parent FROM account_chart() c WHERE c.code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account % is not in the chart', p_code USING ERRCODE = '22023';
  END IF;
  IF v_parent IS NOT NULL THEN
    PERFORM account_ensure(p_tenant, v_parent);
  END IF;
  INSERT INTO accounts (tenant_id, code, parent_code, name, name_en, type, normal_side, final_account, is_group, is_system)
  SELECT p_tenant, c.code, c.parent_code, c.name, c.name_en, c.type, c.normal_side, c.final_account, c.is_group, true
  FROM account_chart() c WHERE c.code = p_code
  ON CONFLICT ON CONSTRAINT accounts_code_unique DO NOTHING;
  SELECT a.id INTO v_id FROM accounts a WHERE a.tenant_id = p_tenant AND a.code = p_code;
  RETURN v_id;
END $$;--> statement-breakpoint

-- A cash account's sub-account for one currency (10: «بحساب فرعي لكل درج وعملة»): six digits
-- under its parent, by a fixed slot per currency so the number never depends on which came
-- first: 111001 «الصندوق — ليرة سورية», 111002 «الصندوق — دولار أمريكي».
CREATE FUNCTION account_ensure_currency(p_tenant uuid, p_parent text, p_currency text) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_slot text := CASE p_currency WHEN 'SYP' THEN '01' WHEN 'USD' THEN '02' END;
  v_label text := CASE p_currency WHEN 'SYP' THEN 'ليرة سورية' WHEN 'USD' THEN 'دولار أمريكي' END;
  v_label_en text := CASE p_currency WHEN 'SYP' THEN 'Syrian pound' WHEN 'USD' THEN 'US dollar' END;
  v_id uuid;
BEGIN
  IF v_slot IS NULL OR p_parent NOT IN ('1110', '1120') THEN
    RAISE EXCEPTION 'no % sub-account of %', p_currency, p_parent USING ERRCODE = '22023';
  END IF;
  SELECT a.id INTO v_id FROM accounts a WHERE a.tenant_id = p_tenant AND a.code = p_parent || v_slot;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  PERFORM account_ensure(p_tenant, p_parent);
  INSERT INTO accounts (tenant_id, code, parent_code, name, name_en, type, normal_side, final_account, is_group, is_system, currency)
  SELECT p_tenant, p_parent || v_slot, p.code,
         CASE p_parent WHEN '1110' THEN 'الصندوق' ELSE p.name END || ' — ' || v_label,
         p.name_en || ' — ' || v_label_en,
         p.type, p.normal_side, p.final_account, false, true, p_currency
  FROM account_chart() p WHERE p.code = p_parent
  ON CONFLICT ON CONSTRAINT accounts_code_unique DO NOTHING;
  SELECT a.id INTO v_id FROM accounts a WHERE a.tenant_id = p_tenant AND a.code = p_parent || v_slot;
  RETURN v_id;
END $$;--> statement-breakpoint

-- Every store's chart: the groups, the 49 accounts of «كل متجر», and a drawer and a safe account
-- for each currency the store trades in. Called at sign-up, and below for the existing stores.
CREATE FUNCTION accounts_seed(p_tenant uuid) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_currency text;
BEGIN
  INSERT INTO accounts (tenant_id, code, parent_code, name, name_en, type, normal_side, final_account, is_group, is_system)
  SELECT p_tenant, c.code, c.parent_code, c.name, c.name_en, c.type, c.normal_side, c.final_account, c.is_group, true
  FROM account_chart() c WHERE c.every_store
  ON CONFLICT ON CONSTRAINT accounts_code_unique DO NOTHING;
  FOR v_currency IN
    SELECT DISTINCT x FROM tenant_settings s, unnest(array_append(s.enabled_currencies, s.base_currency)) AS x
    WHERE s.tenant_id = p_tenant AND x IN ('SYP', 'USD') ORDER BY x
  LOOP
    PERFORM account_ensure_currency(p_tenant, '1110', v_currency);
    PERFORM account_ensure_currency(p_tenant, '1120', v_currency);
  END LOOP;
END $$;--> statement-breakpoint

-- ─── The ledger's guarantees ─────────────────────────────────────────────────
-- Nothing is posted to a group, and a single-currency account takes only its currency.
CREATE FUNCTION journal_lines_check_account() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_group boolean;
  v_currency text;
BEGIN
  SELECT a.is_group, a.currency INTO v_group, v_currency
  FROM accounts a WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.account_id;
  IF v_group THEN
    RAISE EXCEPTION 'account % is a group: nothing is posted to it', NEW.account_id USING ERRCODE = '23514';
  END IF;
  IF v_currency IS NOT NULL AND v_currency <> NEW.currency THEN
    RAISE EXCEPTION 'account % takes % only, not %', NEW.account_id, v_currency, NEW.currency USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER journal_lines_account BEFORE INSERT ON "journal_lines" FOR EACH ROW EXECUTE FUNCTION journal_lines_check_account();--> statement-breakpoint

-- Every entry the statement touched balances in the base currency, equals its total and has two
-- lines at least. An entry's lines therefore go in with one statement.
CREATE FUNCTION journal_lines_check_balance() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_bad record;
BEGIN
  SELECT e.id, e.number, e.total_minor, s.debit, s.credit, s.n INTO v_bad
  FROM (SELECT DISTINCT n.tenant_id, n.entry_id FROM new_lines n) t
  JOIN journal_entries e ON e.tenant_id = t.tenant_id AND e.id = t.entry_id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(l.debit_minor), 0) AS debit, coalesce(sum(l.credit_minor), 0) AS credit, count(*) AS n
    FROM journal_lines l WHERE l.tenant_id = e.tenant_id AND l.entry_id = e.id
  ) s
  WHERE s.debit <> s.credit OR s.debit <> e.total_minor OR s.n < 2
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'journal entry % does not balance: debit %, credit %, total %, % lines',
      v_bad.number, v_bad.debit, v_bad.credit, v_bad.total_minor, v_bad.n USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER journal_lines_balanced AFTER INSERT ON "journal_lines" REFERENCING NEW TABLE AS new_lines FOR EACH STATEMENT EXECUTE FUNCTION journal_lines_check_balance();--> statement-breakpoint

-- An entry without lines never commits.
CREATE FUNCTION journal_entries_check_lines() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.tenant_id = NEW.tenant_id AND l.entry_id = NEW.id) THEN
    RAISE EXCEPTION 'journal entry % has no lines', NEW.number USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_have_lines AFTER INSERT ON "journal_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entries_check_lines();--> statement-breakpoint

-- Posted entries never change: a correction is a reversing entry (10 › قواعد الضمان 2).
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "journal_lines" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "accounts" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "journal_sequences" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint

-- ─── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "accounts" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "journal_entries", "journal_lines" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "journal_sequences" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("last_number") ON "journal_sequences" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("duplicate_count", "last_duplicate_at") ON "sync_inbox" TO serva_app;--> statement-breakpoint

-- ─── Existing stores ─────────────────────────────────────────────────────────
SELECT accounts_seed(t.id) FROM "tenants" t;--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['report.view', 'accounting.view']
WHERE "is_system" AND "key" IN ('owner', 'manager') AND NOT ('report.view' = ANY ("permissions"));
