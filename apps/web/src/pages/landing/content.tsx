import type { ReactNode } from 'react';
import type { IcoName } from './Ico';

/** What a sector panel shows under its title: a real screenshot or a small drawn example. */
export type SectorVisual =
  | { kind: 'shot'; name: string; alt: string; w: number; h: number; keep?: boolean }
  | { kind: 'mock'; mock: ReactNode };

export interface Sector {
  id: string;
  label: string;
  sub: string;
  feats: readonly (readonly [string, string])[];
  visual: SectorVisual;
}

const Note = ({ children = 'رسم توضيحي بأرقام مثال' }: { children?: string }) => (
  <div className="mock-note">{children}</div>
);

const sizeCell = (kind: '' | 'hi' | 'lo' | 'z', n: number, key: string) => (
  <span key={key} className={kind ? `c ${kind} num` : 'c num'}>
    {n}
  </span>
);

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
const GRID: readonly {
  color: string;
  name: string;
  cells: readonly (readonly ['' | 'hi' | 'lo' | 'z', number])[];
}[] = [
  {
    color: 'beige',
    name: 'بيج',
    cells: [
      ['hi', 8],
      ['hi', 12],
      ['', 6],
      ['lo', 2],
      ['z', 0],
    ],
  },
  {
    color: 'navy',
    name: 'كحلي',
    cells: [
      ['', 5],
      ['hi', 9],
      ['hi', 11],
      ['', 4],
      ['lo', 1],
    ],
  },
  {
    color: 'wine',
    name: 'عنابي',
    cells: [
      ['lo', 2],
      ['', 4],
      ['', 5],
      ['z', 0],
      ['z', 0],
    ],
  },
];

const ClothMock = () => (
  <>
    <h5>قميص كتّان · شبكة المخزون</h5>
    <div className="sub">المقاس × اللون</div>
    <div className="grid-size">
      <span />
      {SIZES.map((s) => (
        <span key={s} className="h">
          {s}
        </span>
      ))}
      {GRID.flatMap((row) => [
        <span key={row.name}>
          <i className={`sw ${row.color}`} />
          {row.name}
        </span>,
        ...row.cells.map(([kind, n], i) => sizeCell(kind, n, `${row.name}-${String(i)}`)),
      ])}
    </div>
    <Note />
  </>
);

const MedMock = () => (
  <>
    <h5>جهاز ضغط · سجل القطع</h5>
    <div className="sub">كل رقم تسلسلي ومصيره</div>
    <div className="rows">
      <div className="r">
        <div className="g">
          <b className="num">SN-48201</b>
          <small>بيع لعيادة الدكتور هاني</small>
        </div>
        <span className="badge b-ok">كفالة حتى 2027/06</span>
      </div>
      <div className="r">
        <div className="g">
          <b className="num">SN-48202</b>
          <small>في المخزون</small>
        </div>
        <span className="badge b-info">متوفر</span>
      </div>
      <div className="r">
        <div className="g">
          <b className="num">SN-47955</b>
          <small>طلب صيانة مفتوح</small>
        </div>
        <span className="badge b-warn">في الصيانة</span>
      </div>
    </div>
    <Note />
  </>
);

const RestMock = () => (
  <>
    <h5>الصالة · الآن</h5>
    <div className="sub">لوحة الطاولات</div>
    <div className="tables">
      <div className="tbl busy">
        <b className="num">1</b>مشغولة
      </div>
      <div className="tbl wait">
        <b className="num">2</b>بانتظار الحساب
      </div>
      <div className="tbl free">
        <b className="num">3</b>فاضية
      </div>
      <div className="tbl busy">
        <b className="num">4</b>مشغولة
      </div>
    </div>
    <div className="k-ticket">
      <div>
        <b>المطبخ</b>
        <br />
        <span className="mu">طاولة 1 · قيد التحضير</span>
      </div>
      <div>
        <b>النادل</b>
        <br />
        <span className="mu">أرسل طلب طاولة 4</span>
      </div>
    </div>
    <Note>رسم توضيحي</Note>
  </>
);

const INSTALMENTS = [
  ['الدفعة الأولى', 'اليوم', '$120', 'b-ok', 'مدفوعة'],
  ['القسط 1', 'بعد شهر', '$60', 'b-warn', 'قادم'],
  ['القسط 2', 'بعد شهرين', '$60', 'b-warn', 'قادم'],
] as const;

const MobMock = () => (
  <>
    <h5>بيع بالتقسيط · جدول الأقساط</h5>
    <div className="sub">السعر بالدولار</div>
    <div className="rows">
      {INSTALMENTS.map(([title, when, amount, tone, state]) => (
        <div key={title} className="r">
          <div className="g">
            <b>{title}</b>
            <small>{when}</small>
          </div>
          <b className="num">{amount}</b>
          <span className={`badge ${tone}`}>{state}</span>
        </div>
      ))}
    </div>
    <Note />
  </>
);

export const SECTORS: readonly Sector[] = [
  {
    id: 's-super',
    label: 'سوبرماركت',
    sub: 'طابور سريع، ميزان، ومخزون ما بيضيع.',
    feats: [
      ['باركود الميزان', 'مع صندوق اختبار حي.'],
      ['جرد بالهاتف', 'امسح وعدّ بالكاميرا، حتى بلا نت.'],
      ['تالف وهدر', 'من الكاشير بسبب واضح.'],
      ['فاتورة معلّقة', 'والقطع محجوزة لحد ما تكمّل.'],
    ],
    visual: { kind: 'shot', name: 'cart', alt: 'شاشة الكاشير لسوبرماركت', w: 1280, h: 900, keep: true },
  },
  {
    id: 's-pharm',
    label: 'صيدلية',
    sub: 'الدفعات والصلاحية تحت عينك.',
    feats: [
      ['دفعات وصلاحية', 'المنتهي ما بينباع.'],
      ['«بينتهي قريباً»', 'يفتح مرتجعاً جاهزاً للمورد.'],
      ['بدائل بالمادة الفعّالة', 'بنفس العيار والشكل.'],
      ['الأدوية المراقبة', 'سجل خاص وسحب الدفعات المستدعاة.'],
    ],
    visual: { kind: 'shot', name: 'exp', alt: 'تقرير الصلاحية', w: 1280, h: 900 },
  },
  {
    id: 's-cloth',
    label: 'ألبسة',
    sub: 'مقاس ولون وموسم، بلا دفتر.',
    feats: [
      ['شبكة المقاسات × الألوان', 'مخزون لكل خانة.'],
      ['تعديلات وخياطة', 'من الاستلام للتسليم.'],
      ['الأقساط والعربون', 'ورسومها ترجع مع المرتجع.'],
      ['مرتجع وتبديل', 'يرجع للرف «قابل للبيع».'],
    ],
    visual: { kind: 'mock', mock: <ClothMock /> },
  },
  {
    id: 's-med',
    label: 'مستلزمات طبية',
    sub: 'كل قطعة لها رقم، وكل دفعة لها تاريخ.',
    feats: [
      ['أرقام تسلسلية', 'بيع كل جهاز برقمه.'],
      ['كفالة وصيانة', 'على الفاتورة ومربوطة بالجهاز.'],
      ['دفعات وصلاحية', 'مع تنبيه قبل الانتهاء.'],
      ['أسعار عقود', 'سعر خاص للعيادة أو المستشفى.'],
    ],
    visual: { kind: 'mock', mock: <MedMock /> },
  },
  {
    id: 's-rest',
    label: 'مطعم / مقهى',
    sub: 'الصالة والمطبخ على نفس الشاشة.',
    feats: [
      ['لوحة الطاولات', 'نقل ودمج وتقسيم.'],
      ['تطبيق النادل', 'والطلب يوصل المطبخ مباشرة.'],
      ['تقسيم الفاتورة', 'بين الزبائن بلا حاسبة.'],
      ['وصفات وتكلفة الطبق', 'مع هامش الربح.'],
    ],
    visual: { kind: 'mock', mock: <RestMock /> },
  },
  {
    id: 's-mob',
    label: 'جوالات وإلكترونيات',
    sub: 'جهاز غالي، يعني تتبّع دقيق.',
    feats: [
      ['رقم تسلسلي لكل جهاز', 'من الشراء للكفالة.'],
      ['البيع بالتقسيط', 'جدول أقساط وسداد على دفعات.'],
      ['دولار وليرة', 'الجهاز بالدولار والحساب بسعرك.'],
      ['صيانة وكفالة', 'مربوطة بالجهاز نفسه.'],
    ],
    visual: { kind: 'mock', mock: <MobMock /> },
  },
  {
    id: 's-whole',
    label: 'جملة وتوزيع',
    sub: 'مندوبين بالميدان، وحساباتهم بيدك.',
    feats: [
      ['مندوب على جواله', 'مسار وزيارات وطلبيات.'],
      ['عهدة كاش بيد المندوب', 'بتسوية يومية.'],
      ['أسعار عقود وشرائح', 'وشيكات وديون بأعمار.'],
      ['أوامر شراء', 'واستلام على دفعات.'],
    ],
    visual: { kind: 'shot', name: 'reps', alt: 'إدارة المندوبين', w: 1440, h: 900 },
  },
];

export interface GalleryItem {
  id: string;
  icon: IcoName;
  title: string;
  sub: string;
  kind: 'frame' | 'phone';
  frameTitle?: string;
  name: string;
  alt: string;
  w: number;
  h: number;
}

export const GALLERY: readonly GalleryItem[] = [
  {
    id: 'g1',
    icon: 'chart',
    title: 'الميزانية العمومية',
    sub: 'متوازنة لحالها.',
    kind: 'frame',
    frameTitle: 'التقارير · الميزانية العمومية',
    name: 'bs',
    alt: 'الميزانية العمومية',
    w: 1440,
    h: 1000,
  },
  {
    id: 'g2',
    icon: 'scan',
    title: 'الجرد بالهاتف',
    sub: 'امسح وعدّ بالكاميرا.',
    kind: 'phone',
    name: 'count',
    alt: 'الجرد بالهاتف',
    w: 390,
    h: 844,
  },
  {
    id: 'g3',
    icon: 'truck',
    title: 'هاتف المندوب',
    sub: 'المسار والطلبيات.',
    kind: 'phone',
    name: 'rep',
    alt: 'هاتف المندوب',
    w: 780,
    h: 1688,
  },
  {
    id: 'g4',
    icon: 'home',
    title: 'لوحة المالك',
    sub: 'اليوم بنظرة وحدة.',
    kind: 'frame',
    frameTitle: 'الرئيسية',
    name: 'dash',
    alt: 'لوحة المالك',
    w: 1440,
    h: 900,
  },
  {
    id: 'g5',
    icon: 'branch',
    title: 'التحويل بين الفروع',
    sub: 'بالطريق ثم مؤكَّد.',
    kind: 'frame',
    frameTitle: 'المخزون · التحويل بين الفروع',
    name: 'tr',
    alt: 'التحويل بين الفروع',
    w: 1440,
    h: 1010,
  },
];

export const COMPARE: readonly (readonly [string, string, string])[] = [
  ['القيود المحاسبية', 'إدخال وترحيل يدوي', 'قيد تلقائي مع كل عملية'],
  ['انقطاع الإنترنت', 'يتوقف أو مقفل على جهاز', 'يكمّل البيع بلا اتصال'],
  ['الدولار والليرة', 'خانة جانبية', 'عملتان بالفاتورة بسعرك'],
  ['الوصول', 'مثبّت على جهاز واحد', 'من أي جهاز ومتصفح'],
  ['المندوبون والفروع', 'منفصلة عن النظام', 'على نفس النظام'],
  ['الصلاحيات', 'عامة، وأثر قليل', 'لكل دور، مع سجل تدقيق'],
];

export const PROOF: readonly { icon: IcoName; title: string; text: string }[] = [
  { icon: 'book', title: 'قيد لكل عملية', text: 'بيع، شراء، مرتجع، مصروف.' },
  { icon: 'wifi-off', title: 'يكمّل بلا اتصال', text: 'ويتزامن بعدين.' },
  { icon: 'shield', title: 'صلاحيات وتدقيق', text: 'مين فعل شو ومتى.' },
  { icon: 'lock', title: 'إقفال الفترة', text: 'المالك يقفل الشهر.' },
];

/** «ثلاثين يوماً» for the usual trial, «N يوماً» for any other length the platform sets */
export function trialWords(days: number): string {
  return days === 30 ? 'ثلاثين يوماً' : `${String(days)} يوماً`;
}

export function faqs(days: number): readonly { q: string; a: string }[] {
  return [
    {
      q: 'شو بيصير لو انقطع الإنترنت؟',
      a: 'الكاشير يكمّل على الجهاز، والفواتير تنزل للسحابة أول ما يرجع الاتصال.',
    },
    { q: 'لازم بطاقة بنكية للتجربة؟', a: `لا. ${trialWords(days)}، كل الميزات مفتوحة.` },
    {
      q: 'كيف بتتعامل مع الدولار؟',
      a: 'أنت تحدّد سعر الصرف، وتدفع بالليرة أو الدولار أو الاثنين بنفس الفاتورة.',
    },
    {
      q: 'بقدر أنقل بياناتي من برنامجي الحالي؟',
      a: 'نعم، باستيراد الأصناف والزبائن من Excel، واحكينا عالواتساب للباقي.',
    },
    { q: 'شو أحتاج من أجهزة؟', a: 'متصفح على كمبيوتر أو تابلت أو جوال، وطابعة الإيصالات اللي عندك.' },
    {
      q: 'مين يشوف أرقام المحل؟',
      a: 'أنت تحدّد لكل موظف ما يشوفه، وكل عملية مهمة تُسجَّل باسم من نفّذها.',
    },
  ];
}
