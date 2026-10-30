import { DirectionProvider } from '@radix-ui/react-direction';
import { useEffect, useState, type ReactNode } from 'react';
import * as ui from '@serva/ui';
import {
  AdminShell,
  Alert,
  AppIcon,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  CartLine,
  CashierShell,
  CashierStatusBar,
  Checkbox,
  ChoiceCard,
  ConnectionPill,
  CustomersIcon,
  DataTable,
  DeleteIcon,
  DensityProvider,
  Dialog,
  DigitsProvider,
  EmptyState,
  FieldGroup,
  HomeIcon,
  IconButton,
  InboxIcon,
  ItemTile,
  Keypad,
  Logo,
  LogoMark,
  LogoStacked,
  Money,
  MoneyField,
  MoreIcon,
  NavGroup,
  NavItem,
  NumberField,
  PasswordField,
  PhoneShell,
  PhoneTab,
  PrintIcon,
  ProductsIcon,
  Radio,
  RadioGroup,
  RemoveIcon,
  AddIcon,
  SalesIcon,
  SearchField,
  SearchIcon,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  SkeletonText,
  StatTile,
  StatusChip,
  STATUSES,
  Switch,
  Tabs,
  TextField,
  ToastProvider,
  ToggleChip,
  TotalPanel,
  useToast,
  type DataColumn,
  type Density,
  type Digits,
  type Icon,
  type Status,
} from '@serva/ui';

// The component gallery of tab 14 › معرض المكوّنات, at /dev/ui in dev builds only. It shows every
// @serva/ui component in its states, with a toolbar for the theme, the direction, the digits and
// the density. The data is the kit's sample shop day (docs/design/kit/KIT.md › Sample data).

type Theme = 'system' | 'light' | 'dark';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-line pt-8">
      <h2 id={id} className="text-xl font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-ink-subtle">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const ICONS = Object.entries(ui)
  .filter(([name]) => name.endsWith('Icon') && name !== 'AppIcon')
  .map(([name, Glyph]) => [name, Glyph as Icon] as const);

function LogoSection() {
  return (
    <Section id="g-logo" title="الشعار">
      <Row label="العلامة، والأفقي الصغير والكبير، والعمودي">
        <LogoMark className="size-23" label="علامة سيرفا" />
        <Logo />
        <Logo size="lg" />
        <LogoStacked />
      </Row>
      <Row label="أيقونة التطبيق: كبيرة، متوسطة، صغيرة (دون نقطة)">
        <AppIcon className="size-28" label="أيقونة التطبيق كبيرة" />
        <AppIcon className="size-16" label="أيقونة التطبيق متوسطة" />
        <AppIcon className="size-9" small label="أيقونة التطبيق صغيرة" />
      </Row>
    </Section>
  );
}

function IconSection() {
  return (
    <Section id="g-icons" title="الأيقونات">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        {ICONS.map(([name, Glyph]) => (
          <li
            key={name}
            className="flex items-center gap-2 rounded-control bg-surface p-2 text-xs text-ink-muted"
          >
            <Glyph size={24} className="text-ink" />
            <code lang="en" dir="ltr">
              {name}
            </code>
          </li>
        ))}
      </ul>
      <Row label="المقاسات 16 · 20 · 24 · 32 · 48">
        {([16, 20, 24, 32, 48] as const).map((size) => (
          <SearchIcon key={size} size={size} />
        ))}
      </Row>
    </Section>
  );
}

function ButtonSection() {
  const variants = ['primary', 'secondary', 'ghost', 'danger', 'danger-soft'] as const;
  return (
    <Section id="g-buttons" title="الأزرار">
      {variants.map((variant) => (
        <Row key={variant} label={variant}>
          <Button variant={variant}>احفظ المنتج</Button>
          <Button variant={variant} icon={<PrintIcon />}>
            اطبع الإيصال
          </Button>
          <Button variant={variant} loading>
            احفظ المنتج
          </Button>
          <Button variant={variant} disabled>
            احفظ المنتج
          </Button>
        </Row>
      ))}
      <Row label="المقاسات: 32 · 40 · 48 · 56 (والكثافة تختار الافتراضي)">
        <Button size="xs">كثيف</Button>
        <Button size="sm">مضغوط</Button>
        <Button size="md">مريح</Button>
        <Button size="lg">لمس</Button>
        <Button>حسب الكثافة</Button>
      </Row>
      <Row label="زر الأيقونة: اسمه يظهر عند المرور">
        <IconButton label="ابحث" icon={<SearchIcon />} />
        <IconButton label="المزيد" icon={<MoreIcon />} variant="secondary" />
        <IconButton label="احذف السطر" icon={<DeleteIcon />} variant="danger-soft" />
        <IconButton label="أضف" icon={<AddIcon />} variant="primary" />
        <IconButton label="ابحث" icon={<SearchIcon />} disabled />
      </Row>
      <Row label="زر الدفع 72 يحمل المبلغ">
        <div className="w-full max-w-md">
          <Button size="pay">
            <span>ادفع</span>
            <Money minor={128450000} currency="SYP" />
          </Button>
        </div>
      </Row>
    </Section>
  );
}

function FieldSection() {
  const [name, setName] = useState('بقالية أبو خليل');
  const [price, setPrice] = useState<number | null>(195000);
  const [dollars, setDollars] = useState<number | null>(1250);
  const [weight, setWeight] = useState('1.25');
  const [query, setQuery] = useState('');
  const [sugar, setSugar] = useState('medium');
  const [currency, setCurrency] = useState('SYP');
  const [notify, setNotify] = useState(true);
  return (
    <Section id="g-fields" title="الحقول">
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <TextField
          label="اسم المتجر"
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="يظهر على الإيصال"
        />
        <TextField
          label="رقم الجوال"
          defaultValue="0944 12"
          error="رقم الجوال ناقص. اكتبه بعشر خانات تبدأ بـ 09."
          dir="ltr"
        />
        <TextField label="الفرع" defaultValue="الرقة · حي الرميلة" disabled />
        <TextField label="رمز المتجر" defaultValue="RAQ-001" readOnly dir="ltr" />
        <TextField
          label="ملاحظة طويلة جداً تُكتب هنا لتجربة التفاف العنوان"
          defaultValue="Nescafé Gold 200g × 3 مع كيس إضافي"
        />
        <PasswordField label="كلمة السر" defaultValue="raqqa2026" />
        <MoneyField
          label="سعر البيع"
          currency="SYP"
          valueMinor={price}
          onValueChange={setPrice}
          hint="بالليرة الجديدة، دون كسور"
        />
        <MoneyField label="السعر بالدولار" currency="USD" valueMinor={dollars} onValueChange={setDollars} />
        <NumberField label="الوزن" value={weight} onValueChange={setWeight} decimals={3} unit="كغ" />
        <Select label="المدينة" defaultValue="الرقة">
          {['الرقة', 'الطبقة', 'دمشق', 'حلب', 'حمص', 'دير الزور', 'الحسكة'].map((city) => (
            <option key={city}>{city}</option>
          ))}
        </Select>
        <Select label="التصنيف" error="اختر تصنيفاً للمنتج." defaultValue="">
          <option value="" disabled>
            اختر…
          </option>
          <option>مشروبات</option>
        </Select>
        <SearchField
          label="ابحث باسم المنتج أو الباركود"
          value={query}
          onValueChange={setQuery}
          slashShortcut
        />
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <FieldGroup legend="مربعات الاختيار">
          <Checkbox label="اطبع الإيصال بعد كل بيع" defaultChecked />
          <Checkbox label="حدّد الكل" indeterminate />
          <Checkbox label="الطابعة غير موصولة" disabled />
        </FieldGroup>
        <RadioGroup legend="طريقة الدفع">
          <Radio name="g-pay" label="نقداً" defaultChecked />
          <Radio name="g-pay" label="شام كاش" description="يُطلب رمز QR من الزبون" />
          <Radio name="g-pay" label="بالآجل" disabled />
        </RadioGroup>
        <div className="flex flex-col gap-2">
          <Switch label="أرسل الفاتورة على واتساب" checked={notify} onCheckedChange={setNotify} />
          <Switch
            label="البيع دون مخزون"
            description="يسمح ببيع منتج نفد"
            checked={false}
            onCheckedChange={() => {}}
          />
          <Switch label="الوضع الكثيف" checked onCheckedChange={() => {}} disabled />
        </div>
      </div>
      <Row label="أداة التبديل المجزّأة">
        <SegmentedControl
          label="السكر"
          value={sugar}
          onValueChange={setSugar}
          options={[
            { value: 'none', label: 'بلا' },
            { value: 'little', label: 'قليل' },
            { value: 'medium', label: 'وسط' },
            { value: 'extra', label: 'زيادة' },
          ]}
        />
        <SegmentedControl
          label="العملة"
          value={currency}
          onValueChange={setCurrency}
          options={[
            { value: 'SYP', label: 'ل.س' },
            { value: 'USD', label: '$' },
          ]}
        />
      </Row>
      <Row label="الشرائح وبطاقات الاختيار">
        <ToggleChip label="مشروبات ساخنة" defaultChecked />
        <ToggleChip label="حلويات" />
        <ToggleChip label="غير متاح" disabled />
      </Row>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <ChoiceCard
          name="g-sector"
          title="مقهى وكافتيريا"
          description="طلبات، طاولات، وخيارات السكر"
          leading="م"
          defaultChecked
        />
        <ChoiceCard name="g-sector" title="بقالية" description="باركود، وزن، ودين الزبائن" leading="ب" />
      </div>
    </Section>
  );
}

function StatusSection() {
  return (
    <Section id="g-status" title="الشارات والتنبيهات">
      <Row label="شارة الحالة: لون وكلمة دائماً">
        {(Object.keys(STATUSES) as Status[]).map((status) => (
          <StatusChip key={status} status={status} />
        ))}
        <StatusChip status="awaitingPayment">
          <bdi className="num">3</bdi>
        </StatusChip>
      </Row>
      <Row label="الشارة الصغيرة">
        {(['neutral', 'brand', 'success', 'warning', 'danger', 'info'] as const).map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </Row>
      <Row label="حبّة الاتصال">
        <ConnectionPill online />
        <ConnectionPill online={false} />
        <ConnectionPill online={false}>
          دون إنترنت منذ 2:05 م · البيع مستمر · 12 بانتظار الإرسال
        </ConnectionPill>
      </Row>
      <div className="flex max-w-3xl flex-col gap-3">
        <Banner tone="offline" title="دون إنترنت منذ 2:05 م">
          البيع مستمر، و12 فاتورة بانتظار الإرسال. تُرسل وحدها عند عودة الاتصال.
        </Banner>
        <Banner tone="info" action={<Button size="sm">اختر باقتك</Button>}>
          باقي 3 أيام من الباقة المجانية.
        </Banner>
        <Banner tone="warning" onDismiss={() => {}}>
          حليب 1 لتر قارب على النفاد: بقيت 4 قطع.
        </Banner>
        <Banner tone="danger" title="انتهى اشتراكك">
          جدّد الاشتراك لتعود الإدارة كاملة. البيع على الكاشير مستمر.
        </Banner>
        <Banner tone="success">كل شيء أُرسل.</Banner>
        <Banner tone="neutral">صيانة مجدولة الجمعة من 2:00 إلى 3:00 ص.</Banner>
        <Alert tone="error" title="لم نستطع الحفظ">
          لا يوجد إنترنت الآن. ما كتبته محفوظ، حاول مرة أخرى.
        </Alert>
        <Alert tone="success">حُفظ المنتج</Alert>
        <Alert tone="info">رمز الدخول من 4 أرقام.</Alert>
      </div>
    </Section>
  );
}

function ContentSection() {
  return (
    <Section id="g-content" title="البطاقات والمؤشرات">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatTile
          className="md:col-span-2"
          hero
          label="مبيعات اليوم"
          value={<Money minor={128450000} currency="SYP" />}
          footnote={<Money minor={988077} currency="USD" />}
          trend={{ direction: 'up', value: '+12%', comparison: 'عن الخميس الماضي' }}
        />
        <StatTile
          label="الفواتير"
          value={<bdi className="num">214</bdi>}
          trend={{ direction: 'down', value: '−3%', comparison: 'عن الخميس الماضي' }}
        />
        <StatTile label="النقد المتوقع" value={<Money minor={64200000} currency="SYP" />} />
        <StatTile label="الربح" value={<Money minor={23800000} currency="SYP" />} footnote="مؤقت" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader title="بطاقة عادية" action={<IconButton label="المزيد" icon={<MoreIcon />} />} />
          <p className="text-ink-muted">بقالية أبو خليل · الرقة · حي الرميلة</p>
        </Card>
        <Card interactive>
          <CardHeader title="قابلة للضغط" />
          <p className="text-ink-muted">تظهر حدودها وظلّها عند المرور.</p>
        </Card>
        <Card selected>
          <CardHeader title="مختارة" />
          <p className="text-ink-muted">مقهى الياسمين</p>
        </Card>
      </div>
      <Row label="الصورة الرمزية">
        <Avatar name="خالد العلي" />
        <Avatar name="سامر" />
        <Avatar name="أبو أحمد الخلف" size="sm" />
        <span className="flex items-center gap-2">
          <Avatar name="فاطمة الجاسم" />
          <span className="text-ink">فاطمة الجاسم</span>
        </span>
      </Row>
      <Card className="max-w-md">
        <EmptyState
          icon={CustomersIcon}
          title="لا زبائن بعد."
          description="أضف أول زبون، أو استوردهم من ملف."
          action={<Button icon={<AddIcon />}>أضف زبوناً</Button>}
          secondaryAction={<Button variant="ghost">استورد من ملف</Button>}
        />
      </Card>
      <Card className="flex max-w-md flex-col gap-3" aria-busy="true">
        <Skeleton className="h-6 w-1/2" />
        <SkeletonText />
        <Skeleton className="h-12 w-full rounded-control" />
      </Card>
    </Section>
  );
}

function BidiSection() {
  return (
    <Section id="g-bidi" title="اختبار الاتجاه">
      <Card className="flex max-w-3xl flex-col gap-2 text-ink">
        <p>
          رصيد أبو أحمد الخلف: عليه <Money minor={4850000} currency="SYP" signDisplay="never" />.
        </p>
        <p>
          صافي الشهر في التقرير: <Money minor={-300000} currency="SYP" negativeTone />.
        </p>
        <p>
          الدولار: <Money minor={1250} currency="USD" /> بسعر صرف <bdi className="num">130</bdi>.
        </p>
        <p>
          جوال الزبون{' '}
          <bdi className="num" dir="ltr">
            +963 944 123 456
          </bdi>{' '}
          وفاتورته{' '}
          <bdi className="num" dir="ltr">
            INV-001-002-0000154
          </bdi>
          .
        </p>
        <p>
          في السلة <bdi dir="auto">Nescafé Gold 200g × 3</bdi> و<bdi className="num">1.250 كغ × 300</bdi>.
        </p>
        <p>
          خصم <bdi className="num">12%</bdi> حتى 30 تشرين الأول 2026، 4:30 م.
        </p>
      </Card>
    </Section>
  );
}

interface InvoiceRow {
  number: string;
  customer: string;
  status: Status;
  totalMinor: number;
}

const INVOICES: InvoiceRow[] = [
  { number: 'INV-001-002-0000154', customer: 'أبو أحمد الخلف', status: 'credit', totalMinor: 4850000 },
  { number: 'INV-001-002-0000153', customer: 'أم محمد', status: 'paid', totalMinor: 125000 },
  { number: 'INV-001-002-0000152', customer: 'فاطمة الجاسم', status: 'awaitingPayment', totalMinor: 39000 },
  { number: 'INV-001-002-0000151', customer: 'عبد الله الموسى', status: 'cancelled', totalMinor: 18200000 },
];

const COLUMNS: DataColumn<InvoiceRow>[] = [
  {
    key: 'number',
    header: 'رقم الفاتورة',
    cell: (row) => (
      <bdi className="num" dir="ltr">
        {row.number}
      </bdi>
    ),
  },
  { key: 'customer', header: 'الزبون', total: 'المجموع' },
  { key: 'status', header: 'الحالة', cell: (row) => <StatusChip status={row.status} /> },
  {
    key: 'total',
    header: 'المبلغ',
    numeric: true,
    cell: (row) => <Money minor={row.totalMinor} currency="SYP" />,
    total: <Money minor={23214000} currency="SYP" />,
  },
];

function TableSection() {
  const [tab, setTab] = useState<'ready' | 'loading' | 'empty' | 'error'>('ready');
  return (
    <Section id="g-table" title="الجدول والتبويبات">
      <Tabs
        label="حالات الجدول"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: 'ready',
            label: 'مع المجموع',
            count: INVOICES.length,
            content: (
              <DataTable
                caption="فواتير اليوم"
                columns={COLUMNS}
                rows={INVOICES}
                rowKey={(row) => row.number}
              />
            ),
          },
          {
            value: 'loading',
            label: 'يحمّل',
            content: (
              <DataTable
                caption="فواتير اليوم"
                columns={COLUMNS}
                rows={[]}
                rowKey={(row) => row.number}
                loading
              />
            ),
          },
          {
            value: 'empty',
            label: 'فارغ',
            content: (
              <DataTable
                caption="فواتير اليوم"
                columns={COLUMNS}
                rows={[]}
                rowKey={(row) => row.number}
                empty={
                  <EmptyState
                    icon={SalesIcon}
                    title="لا فواتير اليوم بعد."
                    action={<Button>ابدأ البيع</Button>}
                  />
                }
              />
            ),
          },
          {
            value: 'error',
            label: 'خطأ',
            content: (
              <DataTable
                caption="فواتير اليوم"
                columns={COLUMNS}
                rows={[]}
                rowKey={(row) => row.number}
                error="لم نستطع تحميل الفواتير. تأكد من الإنترنت وحاول مرة أخرى."
                onRetry={() => {}}
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

function OverlaySection() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [bottom, setBottom] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <Section id="g-overlays" title="النوافذ والألواح والإشعارات">
      <Row label="افتح">
        <Button variant="secondary" onClick={() => setDialog(true)}>
          نافذة تأكيد
        </Button>
        <Button variant="secondary" onClick={() => setSheet(true)}>
          لوح جانبي
        </Button>
        <Button variant="secondary" onClick={() => setBottom(true)}>
          لوح سفلي للجوال
        </Button>
        <Button variant="secondary" onClick={() => toast({ message: 'حُفظ المنتج' })}>
          إشعار نجاح
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              tone: 'info',
              message: 'حُذف السطر من السلة',
              action: { label: 'تراجع', onClick: () => {} },
            })
          }
        >
          إشعار مع تراجع
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast({ tone: 'error', message: 'لم تُطبع الفاتورة. افحص الطابعة.' })}
        >
          إشعار خطأ
        </Button>
      </Row>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        size="sm"
        title="احذف المنتج؟"
        description="لن يظهر «حليب 1 لتر» في البيع بعد الآن. فواتيره السابقة تبقى كما هي."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              تراجع
            </Button>
            <Button variant="danger" onClick={() => setSecond(true)}>
              احذف المنتج
            </Button>
          </>
        }
      />
      {/* Tab 14: no dialog over a dialog. This second one is refused while the first is open. */}
      <Dialog open={second} onOpenChange={setSecond} title="نافذة ثانية" />
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="الدفع"
        description="فاتورة INV-001-002-0000155"
        footer={
          <Button size="pay" onClick={() => setSheet(false)}>
            <span>أتمّ الدفع</span>
            <Money minor={41000} currency="SYP" />
          </Button>
        }
      >
        <MoneyField label="المبلغ المستلم" currency="SYP" valueMinor={50000} onValueChange={() => {}} />
        <p className="text-ink-muted">
          الباقي: <Money minor={9000} currency="SYP" className="font-bold text-ink" />
        </p>
      </Sheet>
      <Sheet open={bottom} onOpenChange={setBottom} side="bottom" title="فلترة المبيعات" closeOnOutsideClick>
        <SegmentedControl
          label="الفترة"
          value="today"
          onValueChange={() => {}}
          fullWidth
          options={[
            { value: 'today', label: 'اليوم' },
            { value: 'week', label: 'هذا الأسبوع' },
            { value: 'month', label: 'هذا الشهر' },
          ]}
        />
      </Sheet>
    </Section>
  );
}

function CashierSection() {
  const [selectedItem, setSelectedItem] = useState('latte');
  const [line, setLine] = useState<string | null>('latte');
  const [typed, setTyped] = useState('');
  const items = [
    { id: 'espresso', name: 'اسبريسو', price: 9000 },
    { id: 'latte', name: 'لاتيه وسط', price: 12000 },
    { id: 'turkish', name: 'قهوة تركية', price: 6000 },
    { id: 'cake', name: 'كيكة شوكولا مع صوص الكراميل والبندق', price: 11000 },
    { id: 'nescafe', name: 'Nescafé Gold 200g', price: 195000 },
  ];
  return (
    <Section id="g-cashier" title="قطع الكاشير">
      <DensityProvider density="touch">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {items.map((item) => (
            <ItemTile
              key={item.id}
              name={item.name}
              priceMinor={item.price}
              currency="SYP"
              selected={selectedItem === item.id}
              onSelect={() => setSelectedItem(item.id)}
            />
          ))}
          <ItemTile name="حليب 1 لتر" priceMinor={15000} currency="SYP" outOfStock onSelect={() => {}} />
          <ItemTile name="جبنة بيضاء" priceMinor={30000} currency="SYP" weighed onSelect={() => {}} />
          <ItemTile name="أركيلة تفاحتين" priceMinor={35000} currency="SYP" onOffer onSelect={() => {}} />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[26.25rem_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <ul aria-label="السلة">
              <CartLine
                name="لاتيه وسط"
                qtyThousandths={2000}
                unitPriceMinor={12000}
                lineTotalMinor={24000}
                currency="SYP"
                meta="سكر وسط"
                selected={line === 'latte'}
                onSelect={() => setLine(line === 'latte' ? null : 'latte')}
              >
                <IconButton label="أنقص الكمية" icon={<RemoveIcon />} variant="secondary" />
                <IconButton label="زد الكمية" icon={<AddIcon />} variant="secondary" />
                <Button variant="danger-soft" icon={<DeleteIcon />}>
                  احذف السطر
                </Button>
              </CartLine>
              <CartLine
                name="جبنة بيضاء"
                qtyThousandths={1250}
                unit="كغ"
                unitPriceMinor={30000}
                lineTotalMinor={37500}
                currency="SYP"
                meta="خصم 10%"
                selected={line === 'cheese'}
                onSelect={() => setLine(line === 'cheese' ? null : 'cheese')}
              />
              <CartLine
                name="Nescafé Gold 200g"
                qtyThousandths={3000}
                unitPriceMinor={195000}
                lineTotalMinor={585000}
                currency="SYP"
                selected={line === 'nescafe'}
                onSelect={() => setLine(line === 'nescafe' ? null : 'nescafe')}
              />
            </ul>
            <TotalPanel
              totalMinor={646500}
              currency="SYP"
              breakdown={[
                { label: 'المجموع الفرعي', minor: 650250 },
                { label: 'الخصم', minor: -3750 },
              ]}
              secondary={{ minor: 4973, currency: 'USD', rateLabel: 'سعر الصرف 130' }}
              onPay={() => {}}
            />
          </div>
          <div className="flex max-w-sm flex-col gap-3">
            <p className="text-ink-muted">
              كُتب: <bdi className="num font-bold text-ink">{typed || '—'}</bdi>
            </p>
            <Keypad
              onDigit={(digit) => setTyped((value) => value + digit)}
              onBackspace={() => setTyped((value) => value.slice(0, -1))}
              extraKey="."
              onExtraKey={() => setTyped((value) => (value.includes('.') ? value : `${value}.`))}
              quickAmounts={
                <>
                  <Button variant="secondary">
                    <Money minor={500000} currency="SYP" />
                  </Button>
                  <Button variant="secondary">
                    <Money minor={1000000} currency="SYP" />
                  </Button>
                </>
              }
            />
          </div>
        </div>
      </DensityProvider>
    </Section>
  );
}

function ShellSection() {
  return (
    <Section id="g-shells" title="الهياكل">
      <p className="text-sm text-ink-muted">إدارة المتجر (القائمة الجانبية تظهر من عرض 1024)</p>
      <div className="h-[32rem] overflow-hidden rounded-card border border-line">
        <AdminShell
          framed
          sidebar={
            <>
              <Logo />
              <nav aria-label="قائمة المعرض">
                <NavGroup label="اليوم">
                  <li>
                    <NavItem href="#g-shells" active icon={<HomeIcon size={24} />}>
                      الرئيسية
                    </NavItem>
                  </li>
                  <li>
                    <NavItem href="#g-shells" icon={<InboxIcon size={24} />} count={3}>
                      بانتظارك
                    </NavItem>
                  </li>
                  <li>
                    <NavItem href="#g-shells" icon={<ProductsIcon size={24} />}>
                      المنتجات
                    </NavItem>
                  </li>
                </NavGroup>
              </nav>
            </>
          }
          topBar={
            <>
              <p className="flex-1 font-bold text-ink">بقالية أبو خليل</p>
              <Avatar name="خالد العلي" size="sm" />
            </>
          }
        >
          <h3 className="text-2xl font-bold text-ink">الرئيسية</h3>
        </AdminShell>
      </div>
      <p className="text-sm text-ink-muted">الكاشير</p>
      <div className="h-[32rem] overflow-hidden rounded-card border border-line">
        <CashierShell
          framed
          statusBar={
            <CashierStatusBar>
              <Logo />
              <span className="flex-1 text-sm font-semibold text-ink">مقهى الياسمين · سامر</span>
              <ConnectionPill online />
            </CashierStatusBar>
          }
          cart={<p className="p-4 text-ink-muted">السلة فارغة. امسح منتجاً أو اختره.</p>}
        >
          <p className="text-ink-muted">المنتجات هنا.</p>
        </CashierShell>
      </div>
      <p className="text-sm text-ink-muted">جوال صاحب المحل</p>
      <div className="h-[40rem] w-[24.375rem] max-w-full overflow-hidden rounded-card border border-line">
        <PhoneShell
          framed
          top={<p className="flex-1 font-bold text-ink">كيف اليوم؟</p>}
          action={<Button fullWidth>بيع جديد</Button>}
          tabs={
            <>
              <PhoneTab href="#g-shells" active icon={<HomeIcon />}>
                الرئيسية
              </PhoneTab>
              <PhoneTab href="#g-shells" icon={<InboxIcon />} count={3}>
                بانتظارك
              </PhoneTab>
              <PhoneTab href="#g-shells" icon={<SalesIcon />}>
                المبيعات
              </PhoneTab>
              <PhoneTab href="#g-shells" icon={<ProductsIcon />}>
                المنتجات
              </PhoneTab>
              <PhoneTab href="#g-shells" icon={<MoreIcon />}>
                المزيد
              </PhoneTab>
            </>
          }
        >
          <StatTile hero label="مبيعات اليوم" value={<Money minor={128450000} currency="SYP" />} />
        </PhoneShell>
      </div>
    </Section>
  );
}

function Toolbar(props: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  dir: 'rtl' | 'ltr';
  setDir: (dir: 'rtl' | 'ltr') => void;
  digits: Digits;
  setDigits: (digits: Digits) => void;
  density: Density;
  setDensity: (density: Density) => void;
}) {
  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur-sm">
      <h1 className="me-auto text-lg font-bold text-ink">معرض المكوّنات</h1>
      <SegmentedControl
        label="الوضع"
        value={props.theme}
        onValueChange={props.setTheme}
        options={[
          { value: 'system', label: 'حسب الجهاز' },
          { value: 'light', label: 'فاتح' },
          { value: 'dark', label: 'داكن' },
        ]}
      />
      <SegmentedControl
        label="الاتجاه"
        value={props.dir}
        onValueChange={props.setDir}
        options={[
          { value: 'rtl', label: 'RTL' },
          { value: 'ltr', label: 'LTR' },
        ]}
      />
      <SegmentedControl
        label="الأرقام"
        value={props.digits}
        onValueChange={props.setDigits}
        options={[
          { value: 'latn', label: '123' },
          { value: 'arab', label: '١٢٣' },
        ]}
      />
      <SegmentedControl
        label="الكثافة"
        value={props.density}
        onValueChange={props.setDensity}
        options={[
          { value: 'touch', label: 'لمس' },
          { value: 'comfortable', label: 'مريحة' },
          { value: 'compact', label: 'مضغوطة' },
          { value: 'dense', label: 'كثيفة' },
        ]}
      />
    </div>
  );
}

/** The toolbar's starting values can come from the address: /dev/ui?theme=dark&density=touch. */
function fromQuery<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = new URLSearchParams(window.location.search).get(name);
  return allowed.find((option) => option === value) ?? fallback;
}

export function UiGallery() {
  const [theme, setTheme] = useState<Theme>(() =>
    fromQuery('theme', ['system', 'light', 'dark'] as const, 'system'),
  );
  const [dir, setDir] = useState<'rtl' | 'ltr'>(() => fromQuery('dir', ['rtl', 'ltr'] as const, 'rtl'));
  const [digits, setDigits] = useState<Digits>(() => fromQuery('digits', ['latn', 'arab'] as const, 'latn'));
  const [density, setDensity] = useState<Density>(() =>
    fromQuery('density', ['touch', 'comfortable', 'compact', 'dense'] as const, 'comfortable'),
  );

  // The theme is an attribute on the page root, as the user setting will set it (tab 14).
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  return (
    <DirectionProvider dir={dir}>
      <DigitsProvider digits={digits}>
        <ToastProvider>
          <div dir={dir} className="min-h-dvh bg-canvas text-ink">
            <title>معرض المكوّنات · Serva</title>
            <Toolbar {...{ theme, setTheme, dir, setDir, digits, setDigits, density, setDensity }} />
            <DensityProvider density={density}>
              <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8">
                <LogoSection />
                <IconSection />
                <ButtonSection />
                <FieldSection />
                <StatusSection />
                <ContentSection />
                <BidiSection />
                <TableSection />
                <OverlaySection />
                <CashierSection />
                <ShellSection />
              </div>
            </DensityProvider>
          </div>
        </ToastProvider>
      </DigitsProvider>
    </DirectionProvider>
  );
}
