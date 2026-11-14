import { DirectionProvider } from '@radix-ui/react-direction';
import { Fragment, memo, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import * as ui from '@serva/ui';
import {
  AddIcon,
  AdminShell,
  Alert,
  AppIcon,
  ArchiveIcon,
  Avatar,
  BackIcon,
  Badge,
  Balance,
  Banner,
  BarcodeIcon,
  Button,
  Card,
  CardHeader,
  CardIcon,
  CartIcon,
  CartLine,
  CashIcon,
  CashierShell,
  CashierStatusBar,
  CheckIcon,
  Checkbox,
  ChoiceCard,
  cn,
  ConnectionPill,
  CustomersIcon,
  DataTable,
  DeleteIcon,
  DensityProvider,
  DeviceIcon,
  Dialog,
  DigitsProvider,
  EditIcon,
  EmptyState,
  FieldGroup,
  GridIcon,
  HomeIcon,
  IconButton,
  IconChip,
  InboxIcon,
  ItemTile,
  KeyIcon,
  Keypad,
  ListIcon,
  Logo,
  LogoMark,
  LogoStacked,
  LogoutIcon,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Money,
  MoneyField,
  MoreIcon,
  NavGroup,
  NavItem,
  NextIcon,
  NotificationsIcon,
  NumberField,
  OfferIcon,
  PageHeader,
  PasswordField,
  PhoneShell,
  PhoneTab,
  PrintIcon,
  ProductsIcon,
  ProgressBar,
  Radio,
  RadioGroup,
  RemoveIcon,
  SalesIcon,
  SearchField,
  SearchIcon,
  SegmentedControl,
  Select,
  SettingsIcon,
  Sheet,
  ShirtIcon,
  Skeleton,
  SkeletonText,
  Spinner,
  StatTile,
  StatusChip,
  STATUSES,
  StockIcon,
  StoreIcon,
  Switch,
  Tabs,
  TextField,
  TextLink,
  ThemeToggle,
  ToastProvider,
  ToggleChip,
  Tooltip,
  TotalPanel,
  UndoIcon,
  useThemePreference,
  useToast,
  type ButtonVariant,
  type DataColumn,
  type Density,
  type Digits,
  type FloatingSide,
  type Icon,
  type Status,
  type ThemePreference,
} from '@serva/ui';

// The component gallery of tab 14 › معرض المكوّنات, at /dev/ui in dev builds only: every @serva/ui
// component in its states, on the SERFA identity (docs/design/IDENTITY.md, هوية 4 «الزمرّدي»), with
// a toolbar for the theme, the direction, the digits and the density. The sample data is a day at
// «بوتيك الأناقة», a clothing boutique in Damascus, in new Syrian pounds (ل.س).

// ── Sections ──────────────────────────────────────────────────────────────────────────────────

interface SectionInfo {
  id: string;
  title: string;
  description: ReactNode;
}

/** The gallery's parts, in page order: the section list in the toolbar is drawn from it. */
const SECTIONS = {
  logo: {
    id: 'g-logo',
    title: 'الشعار',
    description:
      'العلامة الزمرّدية، و«SERFA» بالحروف اللاتينية، و«سيرفا» تحتها: أفقي للرؤوس، وعمودي لصفحات الدخول، وأيقونة للتطبيق.',
  },
  colors: {
    id: 'g-colors',
    title: 'الألوان',
    description: (
      <>
        كل لون باسمه من <bdi>theme.css</bdi>. الشاشات تكتب الأسماء فقط، فيتبدّل الوضع الداكن وحده. النص على
        خلفية ملوّنة يأخذ درجة <bdi dir="ltr">-ink</bdi> من لونها.
      </>
    ),
  },
  shape: {
    id: 'g-shape',
    title: 'الزوايا والظلال',
    description:
      'أربع زوايا وثلاثة ظلال، ولا ظل دون خط رفيع في الوضع الفاتح. الحركة 120 ميلي ثانية للمرور والضغط، و200 للقوائم والنوافذ.',
  },
  type: {
    id: 'g-type',
    title: 'الخط',
    description: 'IBM Plex Sans Arabic بثلاثة أوزان فقط: 400 و600 و700. كل مبلغ وكمية ورقم وتاريخ بعرض ثابت.',
  },
  icons: {
    id: 'g-icons',
    title: 'الأيقونات',
    description: 'من غلاف واحد بأسماء وظيفية، بخمسة مقاسات. أيقونات الاتجاه تنقلب في العربية، وغيرها لا.',
  },
  buttons: {
    id: 'g-buttons',
    title: 'الأزرار',
    description:
      'زر أساسي واحد في كل شاشة، واسم الزر يقول ما يفعله. الارتفاع من الكثافة، و48 على الأقل تحت الإصبع.',
  },
  fields: {
    id: 'g-fields',
    title: 'الحقول',
    description: 'التسمية فوق الحقل، والتلميح أو الخطأ تحته. الخطأ بلون وأيقونة وجملة تقول ما العمل.',
  },
  cards: {
    id: 'g-cards',
    title: 'البطاقات والمؤشرات',
    description:
      'ترويسة الصفحة، والبطاقة: سطح على خط رفيع وظل خفيف. المؤشر: التسمية، ثم الرقم بعرض ثابت، والتغيّر بسهم ولون وكلمة.',
  },
  table: {
    id: 'g-table',
    title: 'الجدول',
    description:
      'رؤوس هادئة، وصفوف بارتفاع الكثافة، والأرقام في آخر العمود لتصطفّ. مع حالات التحميل والفراغ والخطأ.',
  },
  status: {
    id: 'g-status',
    title: 'الشارات والتنبيهات',
    description: 'كل حالة بلون وكلمة معاً، فلا يعتمد شيء على اللون وحده.',
  },
  loading: {
    id: 'g-loading',
    title: 'التحميل والحالات الفارغة',
    description: 'هيكل رمادي بشكل المحتوى أثناء التحميل، وجملة وخطوة تالية حين لا يوجد شيء بعد.',
  },
  tabs: {
    id: 'g-tabs',
    title: 'التبويبات وأداة التبديل',
    description:
      'تبويبات بخط تحت النشط لأقسام الصفحة، وتبويبات بمسار داخل البطاقات، وأداة تبديل لخيار واحد من خيارات قليلة.',
  },
  overlays: {
    id: 'g-overlays',
    title: 'النوافذ والقوائم والإشعارات',
    description:
      'النافذة للقرار، واللوح للتفاصيل والدفع، والقائمة للإجراءات، والتلميح لاسم الزر، والإشعار لما تمّ.',
  },
  avatars: {
    id: 'g-avatars',
    title: 'الصورة الرمزية',
    description: 'الحرفان الأولان من الاسم على خلفية العلامة الخفيفة، دون صور جاهزة.',
  },
  bidi: {
    id: 'g-bidi',
    title: 'اختبار الاتجاه',
    description: 'المبالغ والأرقام والكلمات اللاتينية داخل جملة عربية، كل منها في عزلة اتجاه خاصة.',
  },
  cashier: {
    id: 'g-cashier',
    title: 'قطع الكاشير',
    description: 'بكثافة اللمس دائماً: 56 لكل ما يُضغط، والمبلغ الإجمالي 40.',
  },
  shells: {
    id: 'g-shells',
    title: 'الهياكل',
    description: 'إطار إدارة المتجر، والكاشير، وجوال صاحب المتجر.',
  },
} as const satisfies Record<string, SectionInfo>;

/** The small heading of a specimen (هوية 4 › Caption). */
const CAPTION = 'text-xs font-semibold text-ink-subtle';

function Section({ id, title, description, children }: SectionInfo & { children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-44 flex-col gap-5">
      <div className="flex flex-col gap-1.5 border-b border-line pb-4">
        <h2 id={`${id}-title`} className="text-xl font-bold text-ink">
          {title}
        </h2>
        <p className="max-w-3xl text-sm text-ink-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** One specimen: a card with a caption over what it shows. */
function Specimen({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-4', className)}>
      <p className={CAPTION}>{label}</p>
      {children}
    </Card>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>;
}

/** A value with its name under it: a size, a radius, a state. */
function Labelled({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="text-xs text-ink-subtle">{label}</span>
    </div>
  );
}

/** A token or class name: Latin, left to right, at the start of its column. */
function Token({ children }: { children: ReactNode }) {
  return (
    <code dir="ltr" lang="en" className="self-start text-xs font-semibold text-ink">
      {children}
    </code>
  );
}

// ── الشعار ──────────────────────────────────────────────────────────────────────────────────────

function LogoSection() {
  return (
    <Section {...SECTIONS.logo}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="flex min-h-64 flex-col items-center justify-center gap-6">
          <Logo size="lg" />
          <p className="text-sm text-ink-muted">
            الأفقي الكبير: العلامة <bdi className="num">92</bdi>، و«<bdi>SERFA</bdi>»{' '}
            <bdi className="num">48</bdi>، و«سيرفا» <bdi className="num">24</bdi>
          </p>
        </Card>
        <div className="flex min-h-64 flex-col justify-between gap-8 rounded-card bg-sidebar p-6 shadow-e1">
          <Logo tone="sidebar" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-sidebar-strong">على القائمة الجانبية</p>
            <p className="text-sm text-sidebar-muted">الأخضر الغامق نفسه في الوضعين: توقيع SERFA.</p>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Specimen label="العلامة وحدها: 32 · 48 · 64 · 92">
          <Row className="flex-1 content-center justify-center gap-5">
            <LogoMark className="size-8" />
            <LogoMark className="size-12" />
            <LogoMark className="size-16" />
            <LogoMark className="size-23" label="علامة سيرفا" />
          </Row>
        </Specimen>
        <Specimen label="أيقونة التطبيق: كبيرة، متوسطة، صغيرة (دون نقطة)">
          <Row className="flex-1 content-center justify-center gap-5">
            <AppIcon className="size-23" label="أيقونة التطبيق كبيرة" />
            <AppIcon className="size-16" label="أيقونة التطبيق متوسطة" />
            <AppIcon className="size-9" small label="أيقونة التطبيق صغيرة" />
          </Row>
        </Specimen>
        <Specimen label="العمودي: صفحات الدخول والتحميل والأخطاء">
          <div className="flex flex-1 items-center justify-center">
            <LogoStacked />
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

// ── الألوان ─────────────────────────────────────────────────────────────────────────────────────

interface Swatch {
  token: string;
  /** The fill, written out whole so Tailwind finds it. */
  fill: string;
  role: string;
}

const COLOR_GROUPS: readonly { title: string; swatches: readonly Swatch[] }[] = [
  {
    title: 'الصفحة والأسطح والطبقة',
    swatches: [
      { token: 'canvas', fill: 'bg-canvas', role: 'الصفحة خلف البطاقات' },
      { token: 'surface', fill: 'bg-surface', role: 'البطاقات والحقول والقوائم' },
      { token: 'surface-muted', fill: 'bg-surface-muted', role: 'المرور، ورأس الجدول، ومسار التبديل' },
      { token: 'surface-total', fill: 'bg-surface-total', role: 'إجمالي الكاشير وصف المجموع' },
      { token: 'overlay', fill: 'bg-overlay', role: 'خلف النوافذ والألواح' },
    ],
  },
  {
    title: 'الخطوط والنص',
    swatches: [
      { token: 'line', fill: 'bg-line', role: 'حدود البطاقات والصفوف' },
      { token: 'line-control', fill: 'bg-line-control', role: 'حدود الحقول ومربعات الاختيار' },
      { token: 'ink', fill: 'bg-ink', role: 'النص الأساسي' },
      { token: 'ink-muted', fill: 'bg-ink-muted', role: 'التسميات والأوصاف' },
      { token: 'ink-subtle', fill: 'bg-ink-subtle', role: 'التلميحات ورؤوس الأعمدة' },
    ],
  },
  {
    title: 'العلامة',
    swatches: [
      { token: 'brand', fill: 'bg-brand', role: 'الإجراء الأساسي والاختيار' },
      { token: 'brand-hover', fill: 'bg-brand-hover', role: 'الأساسي عند المرور' },
      { token: 'on-brand', fill: 'bg-on-brand', role: 'النص فوق الأخضر' },
      { token: 'brand-soft', fill: 'bg-brand-soft', role: 'تعبئة خفيفة للمختار' },
      { token: 'brand-ink', fill: 'bg-brand-ink', role: 'نص بلون العلامة' },
      { token: 'ring', fill: 'bg-ring', role: 'حلقة التركيز' },
    ],
  },
  {
    title: 'المُكمّل التركوازي، باعتدال',
    swatches: [
      { token: 'accent', fill: 'bg-accent', role: 'السلسلة الثانية وطرف تدرّج الشعار' },
      { token: 'on-accent', fill: 'bg-on-accent', role: 'النص فوق التركوازي' },
      { token: 'accent-soft', fill: 'bg-accent-soft', role: 'شريحة مميّزة' },
      { token: 'accent-ink', fill: 'bg-accent-ink', role: 'نص تركوازي' },
    ],
  },
  {
    title: 'القائمة الجانبية: الأخضر الغامق في الوضعين',
    swatches: [
      { token: 'sidebar', fill: 'bg-sidebar', role: 'خلفية القائمة' },
      { token: 'sidebar-hover', fill: 'bg-sidebar-hover', role: 'عند المرور' },
      { token: 'sidebar-active', fill: 'bg-sidebar-active', role: 'الصفحة الحالية' },
      { token: 'sidebar-line', fill: 'bg-sidebar-line', role: 'الفواصل' },
      { token: 'sidebar-ink', fill: 'bg-sidebar-ink', role: 'نص الروابط' },
      { token: 'sidebar-muted', fill: 'bg-sidebar-muted', role: 'عناوين المجموعات' },
      { token: 'sidebar-strong', fill: 'bg-sidebar-strong', role: 'النص النشط والشعار' },
      { token: 'sidebar-brand', fill: 'bg-sidebar-brand', role: 'مؤشر الصفحة الحالية' },
    ],
  },
  {
    title: 'الشعار ولمعة الأزرار: ثابتة في الوضعين',
    swatches: [
      { token: 'mark-from', fill: 'bg-mark-from', role: 'زمرّدي الشعار وظل الزر الأساسي' },
      { token: 'mark-to', fill: 'bg-mark-to', role: 'طرف تدرّج الشعار' },
      { token: 'on-mark', fill: 'bg-on-mark', role: 'حرف S فوق الشعار' },
      { token: 'highlight', fill: 'bg-highlight', role: 'خط الضوء أعلى الزر' },
    ],
  },
  {
    title: 'الرسوم البيانية: بهذا الترتيب دائماً',
    swatches: [
      { token: 'chart-1', fill: 'bg-chart-1', role: 'زمرّدي: السلسلة الأولى' },
      { token: 'chart-2', fill: 'bg-chart-2', role: 'أزرق' },
      { token: 'chart-3', fill: 'bg-chart-3', role: 'برتقالي' },
      { token: 'chart-4', fill: 'bg-chart-4', role: 'بنفسجي' },
      { token: 'chart-5', fill: 'bg-chart-5', role: 'أرجواني' },
      { token: 'chart-6', fill: 'bg-chart-6', role: 'كهرماني' },
    ],
  },
];

/** The four states, each its own column: the solid colour, its soft fill and its words. */
const STATUS_GROUPS: readonly { title: string; swatches: readonly Swatch[] }[] = [
  {
    title: 'نجاح',
    swatches: [
      { token: 'success', fill: 'bg-success', role: 'الأيقونة والشريط' },
      { token: 'success-soft', fill: 'bg-success-soft', role: 'الخلفية' },
      { token: 'success-ink', fill: 'bg-success-ink', role: 'النص' },
    ],
  },
  {
    title: 'تنبيه',
    swatches: [
      { token: 'warning', fill: 'bg-warning', role: 'الأيقونة والشريط' },
      { token: 'warning-soft', fill: 'bg-warning-soft', role: 'الخلفية' },
      { token: 'warning-ink', fill: 'bg-warning-ink', role: 'النص' },
    ],
  },
  {
    title: 'خطأ وحذف',
    swatches: [
      { token: 'danger', fill: 'bg-danger', role: 'زر الحذف والأيقونة' },
      { token: 'on-danger', fill: 'bg-on-danger', role: 'النص فوق الأحمر' },
      { token: 'danger-soft', fill: 'bg-danger-soft', role: 'الخلفية' },
      { token: 'danger-ink', fill: 'bg-danger-ink', role: 'النص' },
    ],
  },
  {
    title: 'معلومة',
    swatches: [
      { token: 'info', fill: 'bg-info', role: 'الأيقونة والشريط' },
      { token: 'info-soft', fill: 'bg-info-soft', role: 'الخلفية' },
      { token: 'info-ink', fill: 'bg-info-ink', role: 'النص' },
    ],
  },
];

/** Every fill with the words it carries (هوية 4 › الألوان: text on a tint takes its -ink). */
const COLOR_PAIRS: readonly { className: string; name: string; tokens: string }[] = [
  { className: 'bg-brand text-on-brand', name: 'رئيسي', tokens: 'brand · on-brand' },
  { className: 'bg-accent text-on-accent', name: 'مُكمّل تركوازي', tokens: 'accent · on-accent' },
  { className: 'bg-brand-soft text-brand-ink', name: 'مختار', tokens: 'brand-soft · brand-ink' },
  { className: 'bg-accent-soft text-accent-ink', name: 'مميّز', tokens: 'accent-soft · accent-ink' },
  { className: 'bg-success-soft text-success-ink', name: 'نجاح', tokens: 'success-soft · success-ink' },
  { className: 'bg-warning-soft text-warning-ink', name: 'تنبيه', tokens: 'warning-soft · warning-ink' },
  { className: 'bg-danger-soft text-danger-ink', name: 'خطأ', tokens: 'danger-soft · danger-ink' },
  { className: 'bg-info-soft text-info-ink', name: 'معلومة', tokens: 'info-soft · info-ink' },
  { className: 'bg-danger text-on-danger', name: 'حذف نهائي', tokens: 'danger · on-danger' },
  { className: 'bg-surface-total text-ink', name: 'إجمالي الكاشير', tokens: 'surface-total · ink' },
  { className: 'bg-sidebar text-sidebar-ink', name: 'القائمة الجانبية', tokens: 'sidebar · sidebar-ink' },
  { className: 'bg-ink text-surface', name: 'الإشعار والتلميح', tokens: 'ink · surface' },
];

/** One token: its colour, its name, and what it is for. */
function SwatchItem({ swatch }: { swatch: Swatch }) {
  return (
    <li className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={cn('size-11 shrink-0 rounded-control ring-1 ring-line ring-inset', swatch.fill)}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <Token>{swatch.token}</Token>
        <span className="text-xs text-ink-muted">{swatch.role}</span>
      </span>
    </li>
  );
}

function ColorSection() {
  return (
    <Section {...SECTIONS.colors}>
      <Specimen label="كل تعبئة مع نصّها">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COLOR_PAIRS.map((pair) => (
            <li
              key={pair.tokens}
              className={cn(
                'flex min-h-20 flex-col justify-between gap-3 rounded-control p-3 ring-1 ring-line ring-inset',
                pair.className,
              )}
            >
              <span className="text-sm font-semibold">{pair.name}</span>
              <code dir="ltr" lang="en" className="self-start text-xs">
                {pair.tokens}
              </code>
            </li>
          ))}
        </ul>
      </Specimen>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {COLOR_GROUPS.map((group) => (
          <Specimen key={group.title} label={group.title}>
            <ul className="flex flex-col gap-3">
              {group.swatches.map((swatch) => (
                <SwatchItem key={swatch.token} swatch={swatch} />
              ))}
            </ul>
          </Specimen>
        ))}
      </div>
      <Specimen label="الحالات: للحالة فقط، ومعها أيقونة أو كلمة">
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {STATUS_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-ink">{group.title}</p>
              <ul className="flex flex-col gap-3">
                {group.swatches.map((swatch) => (
                  <SwatchItem key={swatch.token} swatch={swatch} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

// ── الزوايا والظلال ─────────────────────────────────────────────────────────────────────────────

const RADII: readonly { className: string; token: string; size: string; use: string }[] = [
  { className: 'rounded-small', token: 'small', size: '8', use: 'الشرائح وعناصر القوائم' },
  { className: 'rounded-control', token: 'control', size: '10', use: 'الأزرار والحقول' },
  { className: 'rounded-card', token: 'card', size: '16', use: 'البطاقات والجداول والقوائم' },
  { className: 'rounded-panel', token: 'panel', size: '20', use: 'النوافذ والألواح' },
  { className: 'rounded-full', token: 'full', size: '—', use: 'الشارات والصور الرمزية والمفاتيح' },
];

const SHADOWS: readonly { className: string; token: string; name: string; use: string }[] = [
  { className: 'shadow-e1', token: 'e1', name: 'خفيف', use: 'البطاقات والأزرار الثانوية، مع خط رفيع' },
  { className: 'shadow-e2', token: 'e2', name: 'مرفوع', use: 'البطاقة عند المرور، والتلميح' },
  { className: 'shadow-e3', token: 'e3', name: 'عائم', use: 'النوافذ والألواح والقوائم والإشعارات' },
];

function ShapeSection() {
  return (
    <Section {...SECTIONS.shape}>
      <Specimen label="الزوايا">
        <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {RADII.map((radius) => (
            <li key={radius.token} className="flex flex-col gap-1.5">
              <span
                aria-hidden="true"
                className={cn('mb-2 size-20 border-2 border-brand/40 bg-brand-soft', radius.className)}
              />
              <Token>{`rounded-${radius.token}`}</Token>
              <span className="text-xs text-ink-muted">
                <bdi className="num">{radius.size}</bdi> · {radius.use}
              </span>
            </li>
          ))}
        </ul>
      </Specimen>
      <ul className="grid gap-6 sm:grid-cols-3">
        {SHADOWS.map((shadow) => (
          <li
            key={shadow.token}
            className={cn(
              'flex min-h-32 flex-col justify-end gap-1.5 rounded-card border border-line bg-surface p-5',
              shadow.className,
            )}
          >
            <Token>{`shadow-${shadow.token}`}</Token>
            <span className="font-semibold text-ink">{shadow.name}</span>
            <span className="text-sm text-ink-muted">{shadow.use}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── الخط ────────────────────────────────────────────────────────────────────────────────────────

const TYPE_STEPS: readonly { name: string; size: string; className: string; sample: ReactNode }[] = [
  { name: 'العرض', size: '30', className: 'text-3xl font-bold', sample: 'متجرك بلمحة واحدة' },
  { name: 'عنوان الصفحة', size: '24', className: 'text-2xl font-bold', sample: 'المنتجات' },
  {
    name: 'عنوان القسم',
    size: '18',
    className: 'text-lg font-semibold',
    sample: 'الأكثر مبيعاً هذا الأسبوع',
  },
  {
    name: 'النص',
    size: '16',
    className: 'text-base',
    sample: 'بيع سريع وإيصال واضح، والمخزون يتحدّث مع كل فاتورة.',
  },
  {
    name: 'نص القوائم',
    size: '15',
    className: 'text-[0.9375rem]',
    sample: 'اطبع الملصق · عدّل السعر · انسخ الموديل',
  },
  {
    name: 'الصغير',
    size: '14',
    className: 'text-sm text-ink-muted',
    sample: 'آخر فاتورة أُرسلت قبل دقيقتين · كاشير المحل',
  },
  {
    name: 'التسمية',
    size: '12',
    className: 'text-xs font-semibold text-ink-subtle',
    sample: 'رأس العمود · الشارة · عنوان المجموعة',
  },
  {
    name: 'المؤشر',
    size: '30',
    className: 'text-kpi font-bold num',
    sample: <Money minor={1342000} currency="SYP" unitClassName="text-sm font-semibold text-ink-subtle" />,
  },
  {
    name: 'إجمالي الكاشير',
    size: '40',
    className: 'text-total font-bold num',
    sample: <Money minor={1342000} currency="SYP" />,
  },
];

function TypeSection() {
  return (
    <Section {...SECTIONS.type}>
      <Specimen label="الدرجات">
        <ul className="flex flex-col">
          {TYPE_STEPS.map((step) => (
            <li
              key={step.name}
              className="grid items-baseline gap-x-6 gap-y-1 border-b border-line py-4 last:border-0 sm:grid-cols-[11rem_minmax(0,1fr)]"
            >
              <span className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-ink">
                  {step.name} · <bdi className="num">{step.size}</bdi>
                </span>
                <Token>{step.className}</Token>
              </span>
              <span className={cn('min-w-0 text-ink', step.className)}>{step.sample}</span>
            </li>
          ))}
        </ul>
      </Specimen>
      <div className="grid gap-4 md:grid-cols-2">
        <Specimen label="ثلاثة أوزان فقط">
          <div className="flex flex-col gap-2 text-2xl text-ink">
            <p className="font-normal">
              عادي <bdi className="num text-base text-ink-subtle">400</bdi>
            </p>
            <p className="font-semibold">
              شبه عريض <bdi className="num text-base text-ink-subtle">600</bdi>
            </p>
            <p className="font-bold">
              عريض <bdi className="num text-base text-ink-subtle">700</bdi>
            </p>
          </div>
        </Specimen>
        <Specimen label="الأرقام بعرض ثابت: تصطفّ في الأعمدة">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl font-bold text-ink">
            <Money minor={178033200} currency="SYP" />
            <span aria-hidden="true" className="text-ink-subtle">
              ·
            </span>
            <Money minor={4500} currency="USD" />
            <span aria-hidden="true" className="text-ink-subtle">
              ·
            </span>
            <bdi className="num" dir="ltr">
              04/11/2026
            </bdi>
          </p>
          <ul className="flex w-48 flex-col gap-1 self-start text-sm text-ink">
            {[111100, 888800, 2045000, 13420000].map((minor) => (
              <li key={minor} className="text-end">
                <Money minor={minor} currency="SYP" />
              </li>
            ))}
          </ul>
        </Specimen>
      </div>
    </Section>
  );
}

// ── الأيقونات ───────────────────────────────────────────────────────────────────────────────────

const ICONS = Object.entries(ui)
  .filter(([name]) => name.endsWith('Icon') && name !== 'AppIcon')
  .map(([name, Glyph]) => [name, Glyph as Icon] as const);

function IconSection() {
  return (
    <Section {...SECTIONS.icons}>
      <Specimen label={`كل الأيقونات (${ICONS.length})`}>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
          {ICONS.map(([name, Glyph]) => (
            <li
              key={name}
              className="flex items-center gap-2.5 rounded-control border border-line px-3 py-2.5 text-xs text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted"
            >
              <Glyph size={20} className="text-ink" />
              <code lang="en" dir="ltr" className="truncate">
                {name}
              </code>
            </li>
          ))}
        </ul>
      </Specimen>
      <div className="grid gap-4 md:grid-cols-2">
        <Specimen label="المقاسات: 16 · 20 · 24 · 32 · 48">
          <Row className="gap-6 text-ink">
            {([16, 20, 24, 32, 48] as const).map((size) => (
              <Labelled key={size} label={<bdi className="num">{size}</bdi>}>
                <ShirtIcon size={size} />
              </Labelled>
            ))}
          </Row>
        </Specimen>
        <Specimen label="أيقونات الاتجاه تنقلب في العربية، والأشياء لا">
          <Row className="gap-6 text-ink">
            <Labelled label="رجوع">
              <BackIcon size={24} />
            </Labelled>
            <Labelled label="التالي">
              <NextIcon size={24} />
            </Labelled>
            <Labelled label="تراجع">
              <UndoIcon size={24} />
            </Labelled>
            <Labelled label="باركود">
              <BarcodeIcon size={24} />
            </Labelled>
            <Labelled label="سلة">
              <CartIcon size={24} />
            </Labelled>
          </Row>
        </Specimen>
      </div>
    </Section>
  );
}

// ── الأزرار ─────────────────────────────────────────────────────────────────────────────────────

const BUTTON_VARIANTS: readonly { variant: ButtonVariant; name: string; label: string; icon: ReactNode }[] = [
  { variant: 'primary', name: 'أساسي', label: 'أضف منتجاً', icon: <AddIcon /> },
  { variant: 'secondary', name: 'ثانوي', label: 'اطبع الإيصال', icon: <PrintIcon /> },
  { variant: 'ghost', name: 'شفاف', label: 'عدّل', icon: <EditIcon /> },
  { variant: 'danger', name: 'خطر', label: 'احذف المنتج', icon: <DeleteIcon /> },
  { variant: 'danger-soft', name: 'خطر خفيف', label: 'احذف السطر', icon: <DeleteIcon /> },
];

const BUTTON_STATES = ['بلا أيقونة', 'مع أيقونة', 'يحمّل', 'معطّل'] as const;

const BUTTON_SIZES = [
  { size: 'xs', height: '32', name: 'كثيف' },
  { size: 'sm', height: '36', name: 'مضغوط' },
  { size: 'md', height: '40', name: 'مريح' },
  { size: 'lg', height: '48', name: 'كبير' },
] as const;

function ButtonSection() {
  const [offersOnly, setOffersOnly] = useState(true);
  const [lowOnly, setLowOnly] = useState(false);
  return (
    <Section {...SECTIONS.buttons}>
      <Specimen label="الأنواع والحالات">
        <div className="overflow-x-auto">
          <div className="grid min-w-max grid-cols-[8rem_repeat(4,minmax(max-content,1fr))] items-center gap-x-6 gap-y-4">
            <span />
            {BUTTON_STATES.map((state) => (
              <span key={state} className={CAPTION}>
                {state}
              </span>
            ))}
            {BUTTON_VARIANTS.map(({ variant, name, label, icon }) => (
              <Fragment key={variant}>
                <span className="flex flex-col items-start">
                  <span className="text-sm font-semibold text-ink">{name}</span>
                  <code dir="ltr" lang="en" className="text-xs text-ink-subtle">
                    {variant}
                  </code>
                </span>
                <span>
                  <Button variant={variant}>{label}</Button>
                </span>
                <span>
                  <Button variant={variant} icon={icon}>
                    {label}
                  </Button>
                </span>
                <span>
                  <Button variant={variant} icon={icon} loading>
                    {label}
                  </Button>
                </span>
                <span>
                  <Button variant={variant} icon={icon} disabled>
                    {label}
                  </Button>
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </Specimen>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="المقاسات بالماوس، و48 على الأقل تحت الإصبع">
          <Row className="items-end gap-5">
            {BUTTON_SIZES.map(({ size, height, name }) => (
              <Labelled key={size} label={<bdi className="num">{height}</bdi>}>
                <Button size={size} variant="secondary">
                  {name}
                </Button>
              </Labelled>
            ))}
            <Labelled label="حسب الكثافة">
              <Button>أضف منتجاً</Button>
            </Labelled>
          </Row>
        </Specimen>
        <Specimen label="زر الأيقونة: اسمه في تلميح عند المرور أو عند الوصول بلوحة المفاتيح">
          <Row>
            <Tooltip content="ابحث بالاسم أو الباركود">
              <IconButton label="ابحث" icon={<SearchIcon />} />
            </Tooltip>
            <Tooltip content="المزيد من الإجراءات">
              <IconButton label="المزيد" icon={<MoreIcon />} variant="secondary" />
            </Tooltip>
            <Tooltip content="أضف منتجاً">
              <IconButton label="أضف" icon={<AddIcon />} variant="primary" />
            </Tooltip>
            <Tooltip content="احذف السطر من السلة">
              <IconButton label="احذف السطر" icon={<DeleteIcon />} variant="danger-soft" />
            </Tooltip>
            <IconButton label="اطبع" icon={<PrintIcon />} variant="secondary" loading />
            <IconButton label="ابحث" icon={<SearchIcon />} disabled />
          </Row>
        </Specimen>
        <Specimen label="زر يبقى مضغوطاً: فلتر يعمل ويتوقف">
          <Row>
            <Button
              variant="secondary"
              icon={<OfferIcon />}
              aria-pressed={offersOnly}
              onClick={() => setOffersOnly((on) => !on)}
            >
              العروض فقط
            </Button>
            <Button
              variant="ghost"
              icon={<StockIcon />}
              aria-pressed={lowOnly}
              onClick={() => setLowOnly((on) => !on)}
            >
              القليل في المخزون
            </Button>
          </Row>
        </Specimen>
        <Specimen label="رابط داخل النص">
          <p className="text-ink">
            ما وصلك رمز الدخول؟ <TextLink href={`#${SECTIONS.buttons.id}`}>أرسله مرة ثانية</TextLink>
          </p>
        </Specimen>
      </div>
      <Specimen label="زر الدفع على الكاشير: 72، والمبلغ في آخره">
        <div className="max-w-md">
          <Button size="pay">
            <span>ادفع</span>
            <Money minor={1342000} currency="SYP" />
          </Button>
        </div>
      </Specimen>
    </Section>
  );
}

// ── الحقول ──────────────────────────────────────────────────────────────────────────────────────

function FieldSection() {
  const [name, setName] = useState('بنطال جينز رجالي');
  const [price, setPrice] = useState<number | null>(350000);
  const [cost, setCost] = useState<number | null>(0);
  const [dollars, setDollars] = useState<number | null>(2700);
  const [quantity, setQuantity] = useState('12');
  const [discount, setDiscount] = useState('10');
  const [query, setQuery] = useState('');
  const [whatsapp, setWhatsapp] = useState(true);
  const [noStock, setNoStock] = useState(false);
  return (
    <Section {...SECTIONS.fields}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="النص">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="اسم المنتج"
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint="يظهر على الإيصال وفي المتجر الإلكتروني"
            />
            <TextField
              label="رقم الجوال"
              defaultValue="0944 12"
              error="رقم الجوال ناقص. اكتبه بعشر خانات تبدأ بـ 09."
              dir="ltr"
            />
            <TextField
              label="الباركود"
              defaultValue="6291041500213"
              dir="ltr"
              startAdornment={<BarcodeIcon />}
            />
            <PasswordField label="كلمة السر" defaultValue="boutique2026" />
            <TextField label="الفرع" defaultValue="دمشق · الشعلان" disabled />
            <TextField label="رمز المتجر" defaultValue="BTQ-001" readOnly dir="ltr" />
          </div>
        </Specimen>
        <Specimen label="المبالغ والأرقام">
          <div className="grid gap-5 sm:grid-cols-2">
            <MoneyField
              label="سعر البيع"
              currency="SYP"
              valueMinor={price}
              onValueChange={setPrice}
              hint="بالليرة الجديدة، دون كسور"
            />
            <MoneyField
              label="سعر الكلفة"
              currency="SYP"
              valueMinor={cost}
              onValueChange={setCost}
              error="اكتب سعراً أكبر من الصفر."
            />
            <MoneyField
              label="السعر بالدولار"
              currency="USD"
              valueMinor={dollars}
              onValueChange={setDollars}
            />
            <NumberField label="الكمية" value={quantity} onValueChange={setQuantity} unit="قطعة" />
            <NumberField label="الخصم" value={discount} onValueChange={setDiscount} unit="%" />
          </div>
        </Specimen>
        <Specimen label="القائمة المنسدلة والبحث">
          <div className="grid gap-5 sm:grid-cols-2">
            <Select label="المقاس" defaultValue="M">
              {['S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </Select>
            <Select label="التصنيف" error="اختر تصنيفاً للمنتج." defaultValue="">
              <option value="" disabled>
                اختر…
              </option>
              {['قمصان', 'بناطيل', 'فساتين', 'أحذية'].map((category) => (
                <option key={category}>{category}</option>
              ))}
            </Select>
            <Select label="المستودع" defaultValue="الرئيسي" disabled>
              <option>الرئيسي</option>
            </Select>
            <SearchField
              label="ابحث بالاسم أو امسح الباركود"
              value={query}
              onValueChange={setQuery}
              slashShortcut
            />
          </div>
        </Specimen>
        <Specimen label="مربعات الاختيار والأزرار الدائرية والمفاتيح">
          <div className="grid gap-6 sm:grid-cols-2">
            <FieldGroup legend="على الإيصال">
              <Checkbox label="اطبع الإيصال بعد كل بيع" defaultChecked />
              <Checkbox label="اطبع شعار المتجر" description="يظهر أعلى الإيصال" />
              <Checkbox label="حدّد الكل" indeterminate />
              <Checkbox label="الطابعة غير موصولة" disabled />
            </FieldGroup>
            <RadioGroup legend="طريقة الدفع">
              <Radio name="g-pay" label="نقداً" defaultChecked />
              <Radio name="g-pay" label="شام كاش" description="يُطلب رمز QR من الزبون" />
              <Radio name="g-pay" label="بطاقة" />
              <Radio name="g-pay" label="بالآجل" disabled />
            </RadioGroup>
            <div className="flex flex-col gap-1">
              <Switch label="أرسل الفاتورة على واتساب" checked={whatsapp} onCheckedChange={setWhatsapp} />
              <Switch
                label="البيع دون مخزون"
                description="يسمح ببيع قطعة نفدت"
                checked={noStock}
                onCheckedChange={setNoStock}
              />
              <Switch label="المتجر الإلكتروني" checked onCheckedChange={() => {}} disabled />
            </div>
            <FieldGroup legend="المقاسات المتوفرة" error="اختر مقاساً واحداً على الأقل.">
              <div className="flex flex-wrap gap-2">
                {['S', 'M', 'L'].map((size) => (
                  <ToggleChip key={size} label={size} />
                ))}
              </div>
            </FieldGroup>
          </div>
        </Specimen>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="الشرائح: تعمل وتتوقف">
          <FieldGroup legend="الألوان" hint="يُختار أكثر من لون">
            <div className="flex flex-wrap gap-2">
              <ToggleChip label="أسود" defaultChecked />
              <ToggleChip label="أبيض" />
              <ToggleChip label="بيج" defaultChecked />
              <ToggleChip label="كحلي" />
              <ToggleChip label="أحمر · نفد" disabled />
            </div>
          </FieldGroup>
          <FieldGroup legend="القصّة">
            <div className="flex flex-wrap gap-2">
              <ToggleChip type="radio" name="g-fit" label="عادية" defaultChecked />
              <ToggleChip type="radio" name="g-fit" label="ضيّقة" />
              <ToggleChip type="radio" name="g-fit" label="واسعة" />
            </div>
          </FieldGroup>
        </Specimen>
        <Specimen label="بطاقات الاختيار: خيار واحد كبير">
          <FieldGroup legend="نوع المتجر">
            <div className="grid gap-3">
              <ChoiceCard
                name="g-sector"
                title="ألبسة وأحذية"
                description="مقاسات وألوان لكل موديل"
                leading={<ShirtIcon />}
                defaultChecked
              />
              <ChoiceCard
                name="g-sector"
                title="بقالية"
                description="باركود، ووزن، ودين الزبائن"
                leading={<CartIcon />}
              />
              <ChoiceCard
                name="g-sector"
                title="إلكترونيات"
                description="أرقام تسلسلية وكفالة"
                leading={<DeviceIcon />}
                disabled
              />
            </div>
          </FieldGroup>
        </Specimen>
      </div>
    </Section>
  );
}

// ── البطاقات والمؤشرات ──────────────────────────────────────────────────────────────────────────

const BEST_SELLERS = [
  { name: 'تيشيرت قطن رجالي', pieces: 42 },
  { name: 'بنطال جينز رجالي', pieces: 31 },
  { name: 'بلوزة نسائية', pieces: 27 },
  { name: 'فستان صيفي', pieces: 18 },
] as const;

function CardsSection() {
  return (
    <Section {...SECTIONS.cards}>
      <Specimen label="ترويسة الصفحة: عنوان واحد لكل صفحة، وإجراءاتها في آخرها">
        <PageHeader
          icon={<ProductsIcon />}
          title="المنتجات"
          description={
            <>
              <bdi className="num">101</bdi> قطعة في <bdi className="num">16</bdi> موديلاً ·{' '}
              <bdi className="num">3</bdi> قاربت على النفاد
            </>
          }
          actions={
            <>
              <Button variant="secondary" icon={<PrintIcon />}>
                اطبع الملصقات
              </Button>
              <Button icon={<AddIcon />}>أضف منتجاً</Button>
            </>
          }
        />
      </Specimen>
      <div className="grid gap-4 lg:grid-cols-3">
        <StatTile
          label="صافي المبيعات اليوم"
          value={<Money minor={1342000} currency="SYP" />}
          trend={{ direction: 'up', value: '+12%', comparison: 'عن الخميس الماضي' }}
          sparkline={[980000, 1040000, 1010000, 1120000, 1090000, 1230000, 1180000, 1290000, 1342000]}
        />
        <StatTile
          label="الربح الإجمالي · الشهر"
          value={<Money minor={71347900} currency="SYP" />}
          trend={{ direction: 'up', value: '+4.1%', comparison: 'عن الشهر الماضي' }}
          footnote={
            <>
              هامش <bdi className="num font-semibold text-ink">41.2%</bdi> من صافي المبيعات
            </>
          }
        />
        <StatTile
          label="أصناف قاربت على النفاد"
          icon={<StockIcon />}
          iconTone="warning"
          value={<bdi className="num">7</bdi>}
          footnote="أقلّها: بلوزة نسائية L · بيج، بقيت قطعتان"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          className="md:col-span-2"
          hero
          label="مبيعات اليوم"
          value={<Money minor={1342000} currency="SYP" />}
          footnote={<Money minor={10323} currency="USD" />}
          trend={{ direction: 'up', value: '+12%', comparison: 'عن الخميس الماضي' }}
        />
        <StatTile
          label="الفواتير"
          icon={<SalesIcon />}
          value={<bdi className="num">38</bdi>}
          trend={{ direction: 'down', value: '−3%', comparison: 'عن الخميس الماضي' }}
        />
        <StatTile
          label="متوسط الفاتورة"
          icon={<CashIcon />}
          iconTone="neutral"
          value={<Money minor={35300} currency="SYP" />}
          footnote="مؤقت حتى إغلاق الوردية"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            icon={<SalesIcon />}
            title="الأكثر مبيعاً"
            description="هذا الأسبوع، بعدد القطع"
            action={
              <Tooltip content="كل التقارير">
                <IconButton label="المزيد" icon={<MoreIcon />} />
              </Tooltip>
            }
          />
          <ol className="flex flex-col divide-y divide-line">
            {BEST_SELLERS.map((item, index) => (
              <li key={item.name} className="flex items-center gap-3 py-2.5 text-sm">
                <bdi className="num w-4 text-ink-subtle">{index + 1}</bdi>
                <span className="flex-1 font-semibold text-ink">{item.name}</span>
                <span className="text-ink-muted">
                  <bdi className="num">{item.pieces}</bdi> قطعة
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <Card interactive>
          <CardHeader
            title="تيشيرت قطن رجالي"
            description={
              <>
                <bdi className="num">4</bdi> مقاسات · <bdi className="num">3</bdi> ألوان
              </>
            }
          />
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-wrap gap-1">
              {['S', 'M', 'L', 'XL'].map((size) => (
                <span
                  key={size}
                  className="rounded-small bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-muted"
                >
                  <bdi>{size}</bdi>
                </span>
              ))}
            </div>
            <Money minor={120000} currency="SYP" className="text-lg font-bold text-ink" />
          </div>
          <p className="mt-4 text-sm text-ink-subtle">بطاقة تفتح شيئاً: ترتفع عند المرور.</p>
        </Card>
        <Card selected>
          <CardHeader icon={<StoreIcon />} title="الفرع الرئيسي" description="دمشق · الشعلان" />
          <p className="text-sm text-ink-muted">البطاقة المختارة: حدّ وتعبئة بلون العلامة.</p>
        </Card>
      </div>
      <Specimen label="أيقونة في مربّع خفيف: الألوان، ثم المقاسات 32 و36 و48">
        <Row className="gap-4">
          {(['brand', 'success', 'warning', 'danger', 'info', 'neutral'] as const).map((tone) => (
            <IconChip key={tone} tone={tone}>
              <ShirtIcon />
            </IconChip>
          ))}
          <span aria-hidden="true" className="h-8 w-px bg-line" />
          <IconChip size="sm">
            <ShirtIcon size={16} />
          </IconChip>
          <IconChip size="md">
            <ShirtIcon />
          </IconChip>
          <IconChip size="lg">
            <ShirtIcon size={24} />
          </IconChip>
        </Row>
      </Specimen>
    </Section>
  );
}

// ── الجدول ──────────────────────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  number: string;
  /** Null for a walk-in sale. */
  customer: string | null;
  cashier: string;
  method: string;
  status: Status | 'return';
  totalMinor: number;
}

const INVOICES: readonly InvoiceRow[] = [
  {
    number: 'INV-001-002-0000429',
    customer: 'ليلى الخطيب',
    cashier: 'ريم',
    method: 'نقداً',
    status: 'paid',
    totalMinor: 350000,
  },
  {
    number: 'INV-001-002-0000428',
    customer: 'رنا السيد',
    cashier: 'ريم',
    method: 'بالآجل',
    status: 'credit',
    totalMinor: 180000,
  },
  {
    number: 'INV-001-002-0000427',
    customer: null,
    cashier: 'ريم',
    method: 'شام كاش',
    status: 'pendingSend',
    totalMinor: 550000,
  },
  {
    number: 'SRT-001-002-0000018',
    customer: 'أحمد الشامي',
    cashier: 'نور',
    method: 'قسيمة',
    status: 'return',
    totalMinor: -120000,
  },
];

const INVOICE_COLUMNS: readonly DataColumn<InvoiceRow>[] = [
  {
    key: 'number',
    header: 'الفاتورة',
    cell: (row) => (
      <bdi className="num font-semibold whitespace-nowrap" dir="ltr">
        {row.number}
      </bdi>
    ),
    total: 'المجموع',
  },
  {
    key: 'customer',
    header: 'الزبون',
    cell: (row) =>
      row.customer ? (
        <span className="flex items-center gap-2.5 whitespace-nowrap">
          <Avatar name={row.customer} size="sm" />
          <span className="font-semibold">{row.customer}</span>
        </span>
      ) : (
        <span className="whitespace-nowrap text-ink-subtle">زبون نقدي</span>
      ),
  },
  {
    key: 'cashier',
    header: 'الكاشير',
    cell: (row) => <span className="whitespace-nowrap text-ink-muted">{row.cashier}</span>,
  },
  {
    key: 'method',
    header: 'طريقة الدفع',
    cell: (row) => <span className="whitespace-nowrap text-ink-muted">{row.method}</span>,
  },
  {
    key: 'status',
    header: 'الحالة',
    cell: (row) =>
      row.status === 'return' ? <Badge tone="danger">مرتجع</Badge> : <StatusChip status={row.status} />,
  },
  {
    key: 'total',
    header: 'المبلغ',
    numeric: true,
    cell: (row) => <Money minor={row.totalMinor} currency="SYP" negativeTone className="font-semibold" />,
    total: <Money minor={960000} currency="SYP" />,
  },
];

function TableSection() {
  const [state, setState] = useState<'ready' | 'loading' | 'empty' | 'error'>('ready');
  const table = {
    caption: 'فواتير اليوم',
    columns: INVOICE_COLUMNS,
    rowKey: (row: InvoiceRow) => row.number,
  };
  return (
    <Section {...SECTIONS.table}>
      <Tabs
        label="حالات الجدول"
        variant="pill"
        value={state}
        onValueChange={setState}
        items={[
          {
            value: 'ready',
            label: 'مع المجموع',
            count: INVOICES.length,
            content: <DataTable {...table} rows={INVOICES} />,
          },
          { value: 'loading', label: 'يحمّل', content: <DataTable {...table} rows={[]} loading /> },
          {
            value: 'empty',
            label: 'فارغ',
            content: (
              <DataTable
                {...table}
                rows={[]}
                empty={
                  <EmptyState
                    icon={SalesIcon}
                    title="لا فواتير اليوم بعد."
                    description="تظهر هنا كل فاتورة من الكاشير لحظة البيع."
                    action={<Button icon={<CartIcon />}>ابدأ البيع</Button>}
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
                {...table}
                rows={[]}
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

// ── الشارات والتنبيهات ──────────────────────────────────────────────────────────────────────────

const BADGE_TONES = [
  { tone: 'neutral', name: 'محايدة' },
  { tone: 'brand', name: 'العلامة' },
  { tone: 'success', name: 'نجاح' },
  { tone: 'warning', name: 'تنبيه' },
  { tone: 'danger', name: 'خطأ' },
  { tone: 'info', name: 'معلومة' },
] as const;

function StatusSection() {
  return (
    <Section {...SECTIONS.status}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="شارة الحالة: لون وكلمة دائماً">
          <Row className="gap-2">
            {(Object.keys(STATUSES) as Status[]).map((status) => (
              <StatusChip key={status} status={status} />
            ))}
            <StatusChip status="awaitingPayment">
              <bdi className="num">3</bdi>
            </StatusChip>
          </Row>
        </Specimen>
        <Specimen label="الشارة الصغيرة: الألوان، ومع رقم، ومع أيقونة، ودون نقطة">
          <Row className="gap-2">
            {BADGE_TONES.map(({ tone, name }) => (
              <Badge key={tone} tone={tone}>
                {name}
              </Badge>
            ))}
          </Row>
          <Row className="gap-2">
            <Badge tone="brand">
              <bdi className="num">12</bdi> طلباً جديداً
            </Badge>
            <Badge tone="brand">
              <Money minor={35000} currency="SYP" /> خصم
            </Badge>
            <Badge tone="success">
              <CheckIcon size={16} />
              متوازن
            </Badge>
            <Badge dot={false}>قريباً</Badge>
          </Row>
          <Row className="gap-2">
            <ConnectionPill online />
            <ConnectionPill online={false} />
            <ConnectionPill online={false}>
              دون إنترنت منذ 2:05 م · البيع مستمر · 12 بانتظار الإرسال
            </ConnectionPill>
          </Row>
        </Specimen>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="الشريط: أعلى الصفحة، لما يخص المتجر كله">
          <div className="flex flex-col gap-3">
            <Banner tone="offline" title="دون إنترنت منذ 2:05 م">
              البيع مستمر، و12 فاتورة بانتظار الإرسال. تُرسل وحدها عند عودة الاتصال.
            </Banner>
            <Banner tone="info" action={<Button size="sm">اختر باقتك</Button>}>
              باقي 3 أيام من الباقة المجانية.
            </Banner>
            <Banner tone="warning" onDismiss={() => {}}>
              بلوزة نسائية L · بيج قاربت على النفاد: بقيت قطعتان.
            </Banner>
            <Banner tone="danger" title="انتهى اشتراكك">
              جدّد الاشتراك لتعود الإدارة كاملة. البيع على الكاشير مستمر.
            </Banner>
            <Banner tone="success">كل شيء أُرسل.</Banner>
            <Banner tone="neutral">صيانة مجدولة الجمعة من 2:00 إلى 3:00 ص.</Banner>
          </div>
        </Specimen>
        <Specimen label="التنبيه: داخل نموذج أو بطاقة">
          <div className="flex flex-col gap-3">
            <Alert tone="error" title="لم نستطع الحفظ">
              لا يوجد إنترنت الآن. ما كتبته محفوظ، حاول مرة أخرى.
            </Alert>
            <Alert tone="warning" title="السعر أقل من الكلفة">
              تبيع «بنطال جينز رجالي» بخسارة <Money minor={20000} currency="SYP" /> في كل قطعة.
            </Alert>
            <Alert tone="info">رمز الدخول من 4 أرقام.</Alert>
            <Alert tone="success">حُفظ المنتج، وظهر على الكاشير.</Alert>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

// ── التحميل والحالات الفارغة ────────────────────────────────────────────────────────────────────

function LoadingSection() {
  return (
    <Section {...SECTIONS.loading}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="شريط التقدّم">
          <div className="flex flex-col gap-5">
            {(
              [
                { label: 'تنزيل بيانات المتجر', value: 64, tone: 'brand', note: '64%' },
                { label: 'هدف المبيعات الشهري', value: 100, tone: 'success', note: 'تمّ' },
                {
                  label: 'صلاحية رمز ربط الجهاز',
                  value: 18,
                  tone: 'warning',
                  note: '8:41 دقيقة باقية',
                },
                { label: 'الأجهزة في باقتك', value: 5, max: 5, tone: 'danger', note: '5 من 5' },
              ] as const
            ).map((bar) => (
              <div key={bar.label} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold text-ink">{bar.label}</span>
                  <bdi className="num text-ink-muted">{bar.note}</bdi>
                </div>
                <ProgressBar
                  label={bar.label}
                  value={bar.value}
                  max={'max' in bar ? bar.max : 100}
                  valueText={bar.note}
                  tone={bar.tone}
                />
              </div>
            ))}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink">تحضير ملف التقرير</span>
              <ProgressBar label="تحضير ملف التقرير" />
            </div>
          </div>
        </Specimen>
        <div className="flex flex-col gap-4">
          <Specimen label="مؤشّر الانتظار: 16 · 20 · 24 · 32 · 48">
            <Row className="gap-6 text-brand">
              {([16, 20, 24, 32, 48] as const).map((size) => (
                <Spinner key={size} size={size} />
              ))}
            </Row>
          </Specimen>
          <Specimen label="الهيكل الرمادي بشكل المحتوى">
            <div aria-busy="true" className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <SkeletonText />
              <Skeleton className="h-10 w-full rounded-control" />
            </div>
          </Specimen>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyState
          icon={OfferIcon}
          title="لا عروض شغّالة اليوم."
          description="أضف عرضاً ليظهر على الكاشير وحده عند البيع."
          action={<Button icon={<AddIcon />}>أضف عرضاً</Button>}
          secondaryAction={<Button variant="ghost">كيف تعمل العروض؟</Button>}
        />
        <EmptyState
          icon={CustomersIcon}
          title="لا زبائن بعد."
          description="أضف أول زبون، أو استوردهم من ملف."
          action={<Button icon={<AddIcon />}>أضف زبوناً</Button>}
          secondaryAction={<Button variant="secondary">استورد من ملف</Button>}
        />
      </div>
    </Section>
  );
}

// ── التبويبات وأداة التبديل ─────────────────────────────────────────────────────────────────────

function TabPanelText({ children }: { children: ReactNode }) {
  return <p className="pt-4 text-sm text-ink-muted">{children}</p>;
}

/** A segment with an icon before its word. */
function SegmentLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center justify-center gap-1.5">
      {icon}
      {children}
    </span>
  );
}

function TabsSection() {
  const [section, setSection] = useState<'products' | 'categories' | 'prices' | 'labels'>('products');
  const [view, setView] = useState<'today' | 'week' | 'month'>('today');
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year'>('week');
  const [currency, setCurrency] = useState<'SYP' | 'USD'>('SYP');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  return (
    <Section {...SECTIONS.tabs}>
      <Specimen label="تبويبات أقسام الصفحة: خط العلامة تحت النشط">
        <Tabs
          label="أقسام المنتجات"
          value={section}
          onValueChange={setSection}
          items={[
            {
              value: 'products',
              label: 'كل المنتجات',
              count: 16,
              content: (
                <TabPanelText>
                  <bdi className="num">101</bdi> قطعة في <bdi className="num">16</bdi> موديلاً، و
                  <bdi className="num">3</bdi> قاربت على النفاد.
                </TabPanelText>
              ),
            },
            {
              value: 'categories',
              label: 'التصنيفات',
              count: 6,
              content: (
                <TabPanelText>قمصان، وبناطيل، وفساتين، وأحذية، وإكسسوارات، وملابس أطفال.</TabPanelText>
              ),
            },
            {
              value: 'prices',
              label: 'تغيير الأسعار',
              content: <TabPanelText>غيّر أسعار موديلات كثيرة دفعة واحدة.</TabPanelText>,
            },
            {
              value: 'labels',
              label: 'الملصقات',
              content: <TabPanelText>اطبع ملصقات الأسعار مع الباركود.</TabPanelText>,
            },
          ]}
        />
      </Specimen>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="تبويبات بمسار: لعروض داخل بطاقة">
          <Tabs
            label="فترة المبيعات"
            variant="pill"
            value={view}
            onValueChange={setView}
            items={[
              {
                value: 'today',
                label: 'اليوم',
                content: (
                  <TabPanelText>
                    <Money minor={1342000} currency="SYP" className="font-semibold text-ink" /> في{' '}
                    <bdi className="num">38</bdi> فاتورة.
                  </TabPanelText>
                ),
              },
              {
                value: 'week',
                label: 'هذا الأسبوع',
                content: (
                  <TabPanelText>
                    <Money minor={8615000} currency="SYP" className="font-semibold text-ink" /> في{' '}
                    <bdi className="num">241</bdi> فاتورة.
                  </TabPanelText>
                ),
              },
              {
                value: 'month',
                label: 'هذا الشهر',
                content: (
                  <TabPanelText>
                    <Money minor={173182000} currency="SYP" className="font-semibold text-ink" /> في{' '}
                    <bdi className="num">977</bdi> فاتورة.
                  </TabPanelText>
                ),
              },
            ]}
          />
        </Specimen>
        <Specimen label="أداة التبديل: خيار واحد دائماً">
          <Row>
            <SegmentedControl
              label="الفترة"
              value={period}
              onValueChange={setPeriod}
              options={[
                { value: 'today', label: 'اليوم' },
                { value: 'week', label: 'الأسبوع' },
                { value: 'month', label: 'الشهر' },
                { value: 'year', label: 'السنة', disabled: true },
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
          <SegmentedControl
            label="طريقة العرض"
            value={layout}
            onValueChange={setLayout}
            fullWidth
            options={[
              { value: 'grid', label: <SegmentLabel icon={<GridIcon size={16} />}>شبكة</SegmentLabel> },
              { value: 'list', label: <SegmentLabel icon={<ListIcon size={16} />}>قائمة</SegmentLabel> },
            ]}
          />
        </Specimen>
      </div>
    </Section>
  );
}

// ── النوافذ والقوائم والإشعارات ─────────────────────────────────────────────────────────────────

const TOOLTIP_SIDES: readonly { side: FloatingSide; label: string }[] = [
  { side: 'top', label: 'فوق' },
  { side: 'bottom', label: 'تحت' },
  { side: 'start', label: 'البداية' },
  { side: 'end', label: 'النهاية' },
];

function OverlaySection() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [bottom, setBottom] = useState(false);
  const [second, setSecond] = useState(false);
  const [received, setReceived] = useState<number | null>(1500000);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  return (
    <Section {...SECTIONS.overlays}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="النافذة واللوح">
          <Row>
            <Button variant="danger-soft" icon={<DeleteIcon />} onClick={() => setDialog(true)}>
              نافذة تأكيد
            </Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>
              لوح جانبي
            </Button>
            <Button variant="secondary" onClick={() => setBottom(true)}>
              لوح سفلي للجوال
            </Button>
          </Row>
        </Specimen>
        <Specimen label="الإشعار المؤقت: 4 ثوانٍ، ويتوقف عند المرور">
          <Row>
            <Button
              variant="secondary"
              onClick={() => toast({ message: 'حُفظت الفاتورة INV-0000430 وطُبع الإيصال' })}
            >
              نجاح
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
              مع تراجع
            </Button>
            <Button
              variant="secondary"
              onClick={() => toast({ tone: 'error', message: 'لم يُطبع الإيصال. افحص الطابعة.' })}
            >
              خطأ
            </Button>
          </Row>
        </Specimen>
        <Specimen label="التلميح: بعد لحظة من المرور، وفوراً من لوحة المفاتيح">
          <Row>
            {TOOLTIP_SIDES.map(({ side, label }) => (
              <Tooltip key={side} side={side} content={`تلميح من ${label}`}>
                <Button variant="secondary">{label}</Button>
              </Tooltip>
            ))}
            <Tooltip content="اطبع آخر فاتورة">
              <IconButton label="اطبع الإيصال" icon={<PrintIcon />} variant="secondary" />
            </Tooltip>
          </Row>
        </Specimen>
        <Specimen label="القائمة: الأسهم تتنقّل، وEsc يغلقها">
          <Row>
            <Menu
              label="حسابي"
              trigger={
                <Button variant="ghost" className="ps-1.5">
                  <Avatar name="سارة الحلبي" size="sm" />
                  سارة الحلبي
                </Button>
              }
            >
              <MenuGroup label="مديرة · بوتيك الأناقة">
                <MenuItem icon={<KeyIcon />} onSelect={() => {}}>
                  رمز الدخول
                </MenuItem>
                <MenuItem
                  icon={<CardIcon />}
                  trailing={<Badge tone="brand">سنوية</Badge>}
                  onSelect={() => {}}
                >
                  الاشتراك
                </MenuItem>
                <MenuItem icon={<SettingsIcon />} shortcut="Alt+S" onSelect={() => {}}>
                  الإعدادات
                </MenuItem>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem icon={<LogoutIcon />} tone="danger" onSelect={() => {}}>
                تسجيل الخروج
              </MenuItem>
            </Menu>
            <Menu
              label="إجراءات المنتج"
              align="end"
              trigger={
                <Tooltip content="إجراءات المنتج">
                  <IconButton label="إجراءات المنتج" icon={<MoreIcon />} variant="secondary" />
                </Tooltip>
              }
            >
              <MenuItem
                icon={<EditIcon />}
                shortcut="E"
                onSelect={() => toast({ tone: 'info', message: 'فتحنا «تيشيرت قطن رجالي» للتعديل' })}
              >
                عدّل المنتج
              </MenuItem>
              <MenuItem
                icon={<PrintIcon />}
                onSelect={() => toast({ message: 'أُرسلت الملصقات إلى الطابعة' })}
              >
                اطبع الملصقات
              </MenuItem>
              <MenuItem icon={<ArchiveIcon />} disabled>
                أرشف الموديل
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<DeleteIcon />} tone="danger" onSelect={() => setDialog(true)}>
                احذف المنتج
              </MenuItem>
            </Menu>
            <span className="flex items-center gap-2 text-sm text-ink-muted">
              <ThemeToggle align="start" />
              زر المظهر: الاختيار نفسه الذي في شريط الأدوات
            </span>
          </Row>
        </Specimen>
      </div>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        size="sm"
        title="احذف المنتج؟"
        description="لن يظهر «بنطال جينز رجالي» في البيع بعد الآن. فواتيره السابقة تبقى كما هي."
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
        description="فاتورة INV-001-002-0000430"
        footer={
          <Button size="pay" onClick={() => setSheet(false)}>
            <span>أتمّ الدفع</span>
            <Money minor={1342000} currency="SYP" />
          </Button>
        }
      >
        <MoneyField label="المبلغ المستلم" currency="SYP" valueMinor={received} onValueChange={setReceived} />
        <p className="text-ink-muted">
          الباقي:{' '}
          <Money
            minor={Math.max(0, (received ?? 0) - 1342000)}
            currency="SYP"
            className="font-bold text-ink"
          />
        </p>
      </Sheet>
      <Sheet open={bottom} onOpenChange={setBottom} side="bottom" title="فلترة المبيعات" closeOnOutsideClick>
        <SegmentedControl
          label="الفترة المعروضة"
          value={period}
          onValueChange={setPeriod}
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

// ── الصورة الرمزية ──────────────────────────────────────────────────────────────────────────────

const TEAM = [
  { name: 'سارة الحلبي', role: 'مديرة', tone: 'brand' },
  { name: 'ريم العلي', role: 'كاشير', tone: 'neutral' },
  { name: 'نور الشامي', role: 'كاشير', tone: 'neutral' },
  { name: 'أبو أحمد الخلف', role: 'أمين المستودع', tone: 'neutral' },
] as const;

function AvatarSection() {
  return (
    <Section {...SECTIONS.avatars}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Specimen label="40 و32، وحدها باسمها">
          <Row className="gap-4">
            <Avatar name="سارة الحلبي" labelled />
            <Avatar name="ريم" labelled />
            <Avatar name="نور الشامي" size="sm" labelled />
          </Row>
        </Specimen>
        <Specimen label="بجانب الاسم المكتوب: للزينة فقط">
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {TEAM.map((person) => (
              <li key={person.name} className="flex items-center gap-3">
                <Avatar name={person.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold text-ink">{person.name}</span>
                  <span className="text-sm text-ink-muted">بوتيك الأناقة</span>
                </span>
                <Badge tone={person.tone}>{person.role}</Badge>
              </li>
            ))}
          </ul>
        </Specimen>
      </div>
    </Section>
  );
}

// ── اختبار الاتجاه ──────────────────────────────────────────────────────────────────────────────

function BidiSection() {
  return (
    <Section {...SECTIONS.bidi}>
      <Card className="flex max-w-3xl flex-col gap-2 text-ink">
        <p>
          رصيد رنا السيد: عليها <Money minor={180000} currency="SYP" signDisplay="never" />.
        </p>
        <p>
          صافي الشهر في التقرير: <Money minor={-300000} currency="SYP" negativeTone />.
        </p>
        <p className="flex flex-wrap items-center gap-3">
          الأرصدة بالكلمة: <Balance minor={180000} currency="SYP" /> <Balance minor={-1250} currency="USD" />{' '}
          <Balance minor={0} currency="SYP" />
        </p>
        <p>
          الدولار: <Money minor={2700} currency="USD" /> بسعر صرف <bdi className="num">130</bdi>.
        </p>
        <p>
          جوال الزبونة{' '}
          <bdi className="num" dir="ltr">
            +963 944 123 456
          </bdi>{' '}
          وفاتورتها{' '}
          <bdi className="num" dir="ltr">
            INV-001-002-0000429
          </bdi>
          .
        </p>
        <p>
          في السلة <bdi dir="auto">Levi&apos;s 501 Original × 2</bdi> و<bdi className="num">3 × تيشيرت M</bdi>
          .
        </p>
        <p>
          خصم <bdi className="num">20%</bdi> على الفساتين حتى 30 تشرين الثاني 2026، 9:00 م.
        </p>
      </Card>
    </Section>
  );
}

// ── قطع الكاشير ─────────────────────────────────────────────────────────────────────────────────

const TILL_ITEMS = [
  { id: 'tshirt', name: 'تيشيرت قطن رجالي', price: 120000, detail: '4 مقاسات · 3 ألوان' },
  { id: 'jeans', name: 'بنطال جينز رجالي', price: 350000, detail: '3 مقاسات' },
  { id: 'blouse', name: 'بلوزة نسائية', price: 280000, detail: '3 ألوان' },
  { id: 'dress', name: 'فستان سهرة طويل مطرّز يدوياً بخيوط ذهبية', price: 1250000 },
  { id: 'levis', name: "Levi's 501 Original", price: 950000 },
] as const;

function CashierSection() {
  const [selectedItem, setSelectedItem] = useState<string>('jeans');
  const [line, setLine] = useState<string | null>('tshirt');
  const [typed, setTyped] = useState('');
  return (
    <Section {...SECTIONS.cashier}>
      <DensityProvider density="touch">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {TILL_ITEMS.map((item) => (
            <ItemTile
              key={item.id}
              name={item.name}
              priceMinor={item.price}
              currency="SYP"
              detail={'detail' in item ? item.detail : undefined}
              selected={selectedItem === item.id}
              onSelect={() => setSelectedItem(item.id)}
            />
          ))}
          <ItemTile name="حزام جلد طبيعي" priceMinor={90000} currency="SYP" outOfStock onSelect={() => {}} />
          <ItemTile name="خيوط تطريز" priceMinor={60000} currency="SYP" weighed onSelect={() => {}} />
          <ItemTile name="فستان صيفي" priceMinor={420000} currency="SYP" onOffer onSelect={() => {}} />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[26.25rem_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
            <ul aria-label="السلة">
              <CartLine
                name="تيشيرت قطن رجالي"
                qtyThousandths={2000}
                unitPriceMinor={120000}
                lineTotalMinor={240000}
                currency="SYP"
                meta="M · أبيض"
                selected={line === 'tshirt'}
                onSelect={() => setLine(line === 'tshirt' ? null : 'tshirt')}
              >
                <IconButton label="أنقص الكمية" icon={<RemoveIcon />} variant="secondary" />
                <IconButton label="زد الكمية" icon={<AddIcon />} variant="secondary" />
                <Button variant="danger-soft" icon={<DeleteIcon />}>
                  احذف السطر
                </Button>
              </CartLine>
              <CartLine
                name="بنطال جينز رجالي"
                qtyThousandths={1000}
                unitPriceMinor={350000}
                lineTotalMinor={315000}
                currency="SYP"
                meta="32 · أزرق · خصم 10%"
                selected={line === 'jeans'}
                onSelect={() => setLine(line === 'jeans' ? null : 'jeans')}
              />
              <CartLine
                name="Levi's 501 Original"
                qtyThousandths={1000}
                unitPriceMinor={950000}
                lineTotalMinor={950000}
                currency="SYP"
                selected={line === 'levis'}
                onSelect={() => setLine(line === 'levis' ? null : 'levis')}
              />
            </ul>
            <TotalPanel
              totalMinor={1505000}
              currency="SYP"
              breakdown={[
                { label: 'المجموع الفرعي', minor: 1540000 },
                { label: 'الخصم', minor: -35000 },
              ]}
              secondary={{ minor: 11577, currency: 'USD', rateLabel: 'سعر الصرف 130' }}
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
              extraKey="00"
              onExtraKey={() => setTyped((value) => `${value}00`)}
              quickAmounts={
                <>
                  <Button variant="secondary">
                    <Money minor={1000000} currency="SYP" />
                  </Button>
                  <Button variant="secondary">
                    <Money minor={2000000} currency="SYP" />
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

// ── الهياكل ─────────────────────────────────────────────────────────────────────────────────────

function ShellSection() {
  const shells = `#${SECTIONS.shells.id}`;
  const [view, setView] = useState<'all' | 'categories'>('all');
  return (
    <Section {...SECTIONS.shells}>
      <p className="text-sm text-ink-muted">إدارة المتجر (القائمة الجانبية تظهر من عرض 1024)</p>
      <div className="h-[36rem] overflow-hidden rounded-panel border border-line shadow-e2">
        <AdminShell
          framed
          sidebar={
            <>
              <Logo />
              <nav aria-label="قائمة المعرض">
                <NavGroup>
                  <li>
                    <NavItem href={shells} active icon={<HomeIcon size={24} />}>
                      الرئيسية
                    </NavItem>
                  </li>
                  <li>
                    <NavItem href={shells} icon={<InboxIcon size={24} />} count={3}>
                      بانتظارك
                    </NavItem>
                  </li>
                </NavGroup>
                <NavGroup label="البيع والزبائن">
                  <li>
                    <NavItem href={shells} icon={<SalesIcon size={24} />}>
                      المبيعات
                    </NavItem>
                  </li>
                  <li>
                    <NavItem href={shells} icon={<CustomersIcon size={24} />}>
                      الزبائن
                    </NavItem>
                  </li>
                </NavGroup>
                <NavGroup label="البضاعة">
                  <li>
                    <NavItem href={shells} icon={<ProductsIcon size={24} />}>
                      المنتجات
                    </NavItem>
                  </li>
                </NavGroup>
              </nav>
            </>
          }
          topBar={
            <>
              <p className="flex flex-1 items-center gap-2.5 font-bold text-ink">
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-small bg-brand-soft text-sm text-brand-ink"
                >
                  ب
                </span>
                بوتيك الأناقة
              </p>
              <ConnectionPill online />
              <Tooltip content="الإشعارات">
                <IconButton label="الإشعارات" icon={<NotificationsIcon />} />
              </Tooltip>
              <ThemeToggle />
              <Avatar name="سارة الحلبي" size="sm" labelled />
            </>
          }
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-2xl font-bold text-ink">المنتجات</h3>
                <p className="text-sm text-ink-muted">
                  <bdi className="num">101</bdi> قطعة في <bdi className="num">16</bdi> موديلاً ·{' '}
                  <bdi className="num">3</bdi> قاربت على النفاد
                </p>
              </div>
              <Button icon={<AddIcon />}>أضف منتجاً</Button>
            </div>
            <Tabs
              label="أقسام المنتجات في المعاينة"
              value={view}
              onValueChange={setView}
              items={[
                {
                  value: 'all',
                  label: 'كل المنتجات',
                  content: (
                    <div className="grid gap-3 pt-4 sm:grid-cols-3">
                      <ItemTile
                        name="تيشيرت قطن رجالي"
                        priceMinor={120000}
                        currency="SYP"
                        detail="4 مقاسات"
                        pictureSlot
                        onSelect={() => {}}
                      />
                      <ItemTile
                        name="بنطال جينز رجالي"
                        priceMinor={350000}
                        currency="SYP"
                        detail="3 مقاسات"
                        pictureSlot
                        onSelect={() => {}}
                      />
                      <EmptyState icon={OfferIcon} title="لا عروض شغّالة اليوم." />
                    </div>
                  ),
                },
                {
                  value: 'categories',
                  label: 'التصنيفات',
                  content: <TabPanelText>قمصان، وبناطيل، وفساتين، وأحذية.</TabPanelText>,
                },
              ]}
            />
          </div>
        </AdminShell>
      </div>
      <p className="text-sm text-ink-muted">الكاشير</p>
      <div className="h-[32rem] overflow-hidden rounded-panel border border-line shadow-e2">
        <CashierShell
          framed
          statusBar={
            <CashierStatusBar>
              <Logo />
              <span className="flex-1 text-sm font-semibold text-ink">بوتيك الأناقة · ريم</span>
              <ConnectionPill online />
            </CashierStatusBar>
          }
          cart={<p className="p-4 text-ink-muted">السلة فارغة. امسح منتجاً أو اختره.</p>}
        >
          <p className="text-ink-muted">المنتجات هنا.</p>
        </CashierShell>
      </div>
      <p className="text-sm text-ink-muted">جوال صاحبة المتجر</p>
      <div className="h-[40rem] w-[24.375rem] max-w-full overflow-hidden rounded-panel border border-line shadow-e2">
        <PhoneShell
          framed
          top={<p className="flex-1 font-bold text-ink">كيف اليوم؟</p>}
          action={<Button fullWidth>بيع جديد</Button>}
          tabs={
            <>
              <PhoneTab href={shells} active icon={<HomeIcon />}>
                الرئيسية
              </PhoneTab>
              <PhoneTab href={shells} icon={<InboxIcon />} count={3}>
                بانتظارك
              </PhoneTab>
              <PhoneTab href={shells} icon={<SalesIcon />}>
                المبيعات
              </PhoneTab>
              <PhoneTab href={shells} icon={<ProductsIcon />}>
                المنتجات
              </PhoneTab>
              <PhoneTab href={shells} icon={<MoreIcon />}>
                المزيد
              </PhoneTab>
            </>
          }
        >
          <StatTile hero label="مبيعات اليوم" value={<Money minor={1342000} currency="SYP" />} />
        </PhoneShell>
      </div>
    </Section>
  );
}

// ── شريط الأدوات ────────────────────────────────────────────────────────────────────────────────

const THEMES = ['system', 'light', 'dark'] as const satisfies readonly ThemePreference[];
const DIRECTIONS = ['rtl', 'ltr'] as const;
const DIGITS = ['latn', 'arab'] as const satisfies readonly Digits[];
const DENSITIES = ['touch', 'comfortable', 'compact', 'dense'] as const satisfies readonly Density[];

type Direction = (typeof DIRECTIONS)[number];

/** A starting value from the address (/dev/ui?theme=dark&density=touch), when it is one we know. */
function fromQuery<T extends string>(search: string, name: string, allowed: readonly T[]): T | undefined {
  const value = new URLSearchParams(search).get(name);
  return allowed.find((option) => option === value);
}

/** A toolbar switch with its name shown before it (the radio group carries the same name). */
function ToolbarSwitch({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className={CAPTION}>
        {caption}
      </span>
      {children}
    </div>
  );
}

/** The page's width and side padding: the toolbar, the section list and the sections share it. */
const PAGE = 'mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-8';

const SECTION_LINK =
  'inline-flex min-h-8 items-center rounded-small px-2.5 text-sm font-semibold whitespace-nowrap text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink pointer-coarse:min-h-12';

function Toolbar(props: {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  dir: Direction;
  setDir: (dir: Direction) => void;
  digits: Digits;
  setDigits: (digits: Digits) => void;
  density: Density;
  setDensity: (density: Density) => void;
}) {
  return (
    <header className="top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md lg:sticky">
      <div className={cn(PAGE, 'flex flex-wrap items-center gap-x-6 gap-y-3 pt-3 pb-2')}>
        <div className="me-auto flex min-w-0 items-center gap-4">
          <Logo />
          <span aria-hidden="true" className="h-9 w-px shrink-0 bg-line" />
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">معرض المكوّنات</h1>
            <p className="text-xs text-ink-subtle">هوية 4 «الزمرّدي» · كل مكوّن بحالاته</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ToolbarSwitch caption="الوضع">
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
          </ToolbarSwitch>
          <ToolbarSwitch caption="الاتجاه">
            <SegmentedControl
              label="الاتجاه"
              value={props.dir}
              onValueChange={props.setDir}
              options={[
                { value: 'rtl', label: 'RTL' },
                { value: 'ltr', label: 'LTR' },
              ]}
            />
          </ToolbarSwitch>
          <ToolbarSwitch caption="الأرقام">
            <SegmentedControl
              label="الأرقام"
              value={props.digits}
              onValueChange={props.setDigits}
              options={[
                { value: 'latn', label: '123' },
                { value: 'arab', label: '١٢٣' },
              ]}
            />
          </ToolbarSwitch>
          <ToolbarSwitch caption="الكثافة">
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
          </ToolbarSwitch>
        </div>
      </div>
      <nav aria-label="أقسام المعرض" className={cn(PAGE, 'scrollbar-none overflow-x-auto')}>
        <ul className="flex w-max gap-1 pb-2">
          {Object.values(SECTIONS).map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className={SECTION_LINK}>
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * Every section, in page order. It takes no props: a toolbar switch reaches it through context alone
 * (the theme, the direction, the digits, the density), so a switch re-renders only what reads it.
 */
const GallerySections = memo(function GallerySections() {
  return (
    <div className={cn(PAGE, 'flex flex-col gap-16 py-10')}>
      <LogoSection />
      <ColorSection />
      <ShapeSection />
      <TypeSection />
      <IconSection />
      <ButtonSection />
      <FieldSection />
      <CardsSection />
      <TableSection />
      <StatusSection />
      <LoadingSection />
      <TabsSection />
      <OverlaySection />
      <AvatarSection />
      <BidiSection />
      <CashierSection />
      <ShellSection />
    </div>
  );
});

export function UiGallery() {
  const { search } = useLocation();
  // The theme switch is the app's own theme choice (هوية 4 › الوضع الداكن): applied at once, kept
  // on this device, and shared with every ThemeToggle on the page and the app's other tabs.
  const [theme, setTheme] = useThemePreference();
  const [dir, setDir] = useState<Direction>(() => fromQuery(search, 'dir', DIRECTIONS) ?? 'rtl');
  const [digits, setDigits] = useState<Digits>(() => fromQuery(search, 'digits', DIGITS) ?? 'latn');
  const [density, setDensity] = useState<Density>(
    () => fromQuery(search, 'density', DENSITIES) ?? 'comfortable',
  );

  // ?theme= makes the same choice as the switch (for screenshots: /dev/ui?theme=dark).
  useEffect(() => {
    const asked = fromQuery(search, 'theme', THEMES);
    if (asked) setTheme(asked);
  }, [search, setTheme]);

  return (
    <DirectionProvider dir={dir}>
      <DigitsProvider digits={digits}>
        <ToastProvider>
          <div dir={dir} className="min-h-dvh bg-canvas text-ink">
            <title>معرض المكوّنات · SERFA</title>
            <Toolbar {...{ theme, setTheme, dir, setDir, digits, setDigits, density, setDensity }} />
            <DensityProvider density={density}>
              <GallerySections />
            </DensityProvider>
          </div>
        </ToastProvider>
      </DigitsProvider>
    </DirectionProvider>
  );
}
