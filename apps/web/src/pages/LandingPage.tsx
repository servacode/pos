import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { normalizePhone, type PlanRow } from '@serva/core';
import { Money, ThemeToggle } from '@serva/ui';
import { limitLines } from '../admin/subscription/planLimits';
import { apiFetch } from '../lib/api';
import { LEGAL } from '../legal/config';
import { useLegal } from '../legal/useLegal';
import {
  COMPARE,
  GALLERY,
  PROOF,
  SECTORS,
  faqs,
  trialWords,
  type GalleryItem,
  type Sector,
} from './landing/content';
import { useLandingLook, useReveal, useSmoothAnchors } from './landing/hooks';
import { Ico, IcoSprite } from './landing/Ico';
import './landing/landing.css';

/** The plans a visitor may choose from: the priced and paid ones, in the platform's order */
const paidPlans = (items: readonly PlanRow[]) =>
  items.filter((p) => p.isActive && !p.isFree && p.priceMonthlyMinor !== null);

type Look = 'a' | 'b';

/** A real screenshot, in the look's own theme (the supermarket one is a single light shot, dimmed in the dark look) */
function Shot({
  name,
  look,
  alt,
  w,
  h,
  keep = false,
  eager = false,
}: {
  name: string;
  look: Look;
  alt: string;
  w: number;
  h: number;
  keep?: boolean;
  eager?: boolean;
}) {
  const theme = keep || look === 'b' ? 'l' : 'd';
  return (
    <img
      className={keep ? 'keep' : undefined}
      src={`/landing/${name}-${theme}.webp`}
      alt={alt}
      width={w}
      height={h}
      loading={eager ? undefined : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : undefined}
    />
  );
}

function Frame({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`frame ${className}`.trim()}>
      <div className="frame-bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Phone({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`phone-s ${className}`.trim()}>
      <div className="scr">{children}</div>
    </div>
  );
}

/** A section's rail (number + label) and its heading, on the 12-column grid */
function SectionHead({
  num,
  label,
  id,
  lead,
  children,
}: {
  num: string;
  label: string;
  id: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="rail">
        <div className="sl">
          <span className="n num">{num}</span>
          <span className="t">{label}</span>
        </div>
      </div>
      <div className="head">
        <h2 className="h2" id={id}>
          {children}
        </h2>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
    </>
  );
}

/** Arrow keys, Home and End move between tabs (RTL: the right arrow goes back, the left one forward) */
function tabKeys(
  event: KeyboardEvent<HTMLElement>,
  count: number,
  current: number,
  select: (index: number) => void,
) {
  const next: Record<string, number> = {
    ArrowDown: current + 1,
    ArrowLeft: current + 1,
    ArrowUp: current - 1,
    ArrowRight: current - 1,
    Home: 0,
    End: count - 1,
  };
  const wanted = next[event.key];
  if (wanted === undefined) return;
  event.preventDefault();
  const target = (wanted + count) % count;
  select(target);
  const tabs = event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
  tabs[target]?.focus();
}

function SectorPanel({ sector, active, look }: { sector: Sector; active: boolean; look: Look }) {
  const { visual } = sector;
  return (
    <div
      className={active ? 'app-panel on' : 'app-panel'}
      id={sector.id}
      role="tabpanel"
      aria-labelledby={`tab-${sector.id}`}
    >
      <div className="pane-head">
        <h3>{sector.label}</h3>
        <p>{sector.sub}</p>
      </div>
      <div className="pane-vis">
        {visual.kind === 'shot' ? (
          <div className="fill">
            <Shot
              name={visual.name}
              look={look}
              alt={visual.alt}
              w={visual.w}
              h={visual.h}
              keep={visual.keep}
            />
          </div>
        ) : (
          <div className="mock-wrap">
            <div className="mock">{visual.mock}</div>
          </div>
        )}
      </div>
      <ul className="pane-feats">
        {sector.feats.map(([title, text]) => (
          <li key={title}>
            <Ico name="check" />
            <div>
              <b>{title}</b>
              <span>{text}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GalleryView({ item, active, look }: { item: GalleryItem; active: boolean; look: Look }) {
  const shot = <Shot name={item.name} look={look} alt={item.alt} w={item.w} h={item.h} />;
  return (
    <div
      className={active ? 'gal-view on' : 'gal-view'}
      id={item.id}
      role="tabpanel"
      aria-labelledby={`tab-${item.id}`}
    >
      <figure>
        {item.kind === 'phone' ? <Phone>{shot}</Phone> : <Frame title={item.frameTitle ?? ''}>{shot}</Frame>}
      </figure>
    </div>
  );
}

const ChatLabel = ({ children }: { children: string }) => (
  <>
    <Ico name="chat" />
    {children}
  </>
);

/** The wa.me address of the platform's support WhatsApp (set in the platform panel), or null while it is not set */
function supportChat(number: string | null): string | null {
  const phone = number ? normalizePhone(number) : null;
  return phone ? `https://wa.me/${phone.replace('+', '')}` : null;
}

/**
 * What a visitor who is not signed in sees at «/»: the approved landing design (specimens «فخم داكن» and
 * «فخم فاتح»; one page, two looks that follow the app's theme). The two doors in stay: sign up
 * («/register») and sign in («/login»). Nothing here is a made-up figure: the plans and prices are the
 * platform's own (the ones the subscription page shows after signing up) and the WhatsApp number is the
 * support one saved in the platform panel; with none set, the chat buttons are not drawn.
 */
export function LandingPage() {
  const navigate = useNavigate();
  const look = useLandingLook();
  const root = useRef<HTMLDivElement>(null);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [sector, setSector] = useState(0);
  const [shot, setShot] = useState(0);
  const legal = useLegal();
  useReveal(root);
  useSmoothAnchors();
  useEffect(() => {
    let alive = true;
    apiFetch<{ items: PlanRow[] }>('/v1/plans')
      .then((r) => alive && setPlans(r.items))
      .catch(() => alive && setPlans([]));
    return () => {
      alive = false;
    };
  }, []);
  const priced = plans ? paidPlans(plans) : [];
  const trialDays = plans?.find((p) => p.trialDays)?.trialDays ?? null;
  const days = trialDays ?? LEGAL.trialDays;
  const startLabel = trialDays ? `ابدأ مجاناً ${String(trialDays)} يوماً` : 'ابدأ مجاناً';
  const chat = supportChat(legal.values.supportWhatsapp);
  const start = () => navigate('/register');
  const signIn = () => navigate('/login');
  const mid = priced.length === 3 ? 1 : -1;

  return (
    <div className="lp" data-v={look} ref={root} id="top">
      <title>سيرفا · كاشير ومحاسبة آلية لمحلّك</title>
      <meta
        name="description"
        content="سيرفا كاشير سحابي ومحاسبة مزدوجة آلية للمحلات في سوريا: ليرة ودولار، يكمّل بلا إنترنت، ومندوبون وفروع."
      />
      <IcoSprite />
      <header className="nav">
        <div className="wrap navin">
          <Link className="logo" to="/" aria-label="سيرفا">
            <img src="/favicon.svg" alt="" width={36} height={36} />
            <span className="logo-t" aria-hidden="true">
              <b>SERVA</b>
              <i>سيرفا</i>
            </span>
          </Link>
          <nav className="nav-links" aria-label="الأقسام">
            <a href="#sectors">القطاعات</a>
            <a href="#why">الفرق</a>
            <a href="#compare">المقارنة</a>
            <a href="#gallery">المنتج</a>
            <a href="#pricing">الأسعار</a>
            <a href="#faq">أسئلة</a>
          </nav>
          <div className="nav-end">
            <ThemeToggle />
            <button type="button" className="btn btn-ghost btn-sm" onClick={signIn}>
              تسجيل الدخول
            </button>
            <button type="button" className="btn btn-primary btn-sm nav-cta" onClick={start}>
              جرّب مجاناً
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-bg" aria-hidden="true" />
          <div className="wrap grid herogrid">
            <div className="hero-head">
              <span className="pill">كاشير سحابي + محاسبة مزدوجة آلية</span>
              {look === 'a' ? (
                <h1 className="display" id="hero-title">
                  <span className="ln">الكاشير يبيع،</span>
                  <span className="ln">
                    <em>والمحاسبة تكتب قيودها وحدها.</em>
                  </span>
                </h1>
              ) : (
                <h1 className="display" id="hero-title">
                  <span className="ln lt">الكاشير يبيع،</span>
                  <span className="ln">
                    <b>والمحاسبة</b> <span className="lt">تكتب</span> <em>قيودها وحدها.</em>
                  </span>
                </h1>
              )}
            </div>
            <div className="hero-copy">
              <p className="lead">
                كل فاتورة بتصير قيد جاهز، بالليرة والدولار على سعرك أنت، وبيكمّل لما ينقطع النت.
              </p>
              <div className="cta-row">
                <button type="button" className="btn btn-primary btn-lg" onClick={start}>
                  {startLabel}
                  <Ico name="arrow" />
                </button>
                <button type="button" className="btn btn-ghost btn-lg" onClick={signIn}>
                  لدي حساب
                </button>
              </div>
              <ul className="trust">
                <li>
                  <Ico name="wifi-off" /> يشتغل بلا إنترنت
                </li>
                <li>
                  <Ico name="coins" /> ليرة ودولار
                </li>
                <li>
                  <Ico name="card" /> بدون بطاقة بنكية
                </li>
              </ul>
            </div>
            <div className="hero-stage">
              {look === 'b' ? (
                <div className="ghost" aria-hidden="true">
                  <Shot name="dash" look={look} alt="" w={1440} h={900} />
                </div>
              ) : null}
              <div className="tilt">
                <Frame className="main" title="شاشة الكاشير · دفع مقسّم على الحساب">
                  <Shot name="pay" look={look} alt="شاشة الكاشير في سيرفا" w={1440} h={900} eager />
                </Frame>
              </div>
              <div className="float je" role="group" aria-label="مثال توضيحي لقيد آلي">
                <h4>
                  <Ico name="book" /> القيد انكتب لحاله <small>مثال توضيحي</small>
                </h4>
                <div className="jr">
                  <b>الصندوق</b>
                  <span className="num">500</span>
                </div>
                <div className="jr">
                  <b>ذمم العملاء</b>
                  <span className="num">1,680</span>
                </div>
                <div className="jr">
                  <b className="cr">المبيعات</b>
                  <span className="num">2,180</span>
                </div>
                <div className="jr tot">
                  <span>مدين = دائن</span>
                  <span className="num">2,180</span>
                </div>
              </div>
              <div className="float off">
                <span className="ico-t">
                  <Ico name="wifi-off" />
                </span>
                <div>
                  <b>انقطع الإنترنت؟ كمّل بيع</b>
                  <span>تتزامن الفواتير لما يرجع</span>
                </div>
              </div>
              <Phone className="hero-phone">
                <Shot name="rep" look={look} alt="مسار المندوب على الجوال" w={780} h={1688} />
              </Phone>
            </div>
          </div>
        </section>

        <section className="proof" aria-label="ما يميّز سيرفا">
          <div className="wrap rv">
            <div className="proof-in">
              {PROOF.map((p) => (
                <div key={p.title}>
                  <Ico name={p.icon} lg />
                  <p>
                    <b>{p.title}</b>
                    <span>{p.text}</span>
                  </p>
                </div>
              ))}
            </div>
            {/* TODO: customer logos and quotes go here, only after their written consent (no made-up ones). */}
          </div>
        </section>

        <section className="sec" id="sectors" aria-labelledby="h-sectors">
          <div className="wrap grid">
            <SectionHead num="01" label="القطاعات" id="h-sectors" lead="اختار نوع محلك وشوف شو بيتغيّر.">
              محلك مو «نشاط عام». له أدواته.
            </SectionHead>
            <div className="body rv">
              <div className="app">
                <div className="app-bar" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <span>سيرفا · عرض تفاعلي</span>
                </div>
                <div className="app-grid">
                  <div
                    className="app-nav"
                    role="tablist"
                    aria-label="نوع المحل"
                    aria-orientation="vertical"
                    tabIndex={-1}
                    onKeyDown={(e) => tabKeys(e, SECTORS.length, sector, setSector)}
                  >
                    <div className="app-nav-t" aria-hidden="true">
                      نوع المحل
                    </div>
                    {SECTORS.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className="nav-i"
                        role="tab"
                        id={`tab-${s.id}`}
                        aria-controls={s.id}
                        aria-selected={i === sector}
                        tabIndex={i === sector ? 0 : -1}
                        onClick={() => setSector(i)}
                      >
                        <span className="d" />
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="app-stage">
                    {SECTORS.map((s, i) => (
                      <SectorPanel key={s.id} sector={s} active={i === sector} look={look} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec band" id="why" aria-labelledby="h-why">
          <div className="wrap grid">
            <SectionHead num="02" label="الفرق" id="h-why" lead="اللي بيفرق بيوم الشغل الحقيقي بسوريا.">
              ست أشياء، بمكان واحد.
            </SectionHead>
            <div className="body bento rv">
              <article className="tile c-a">
                <span className="k">
                  <Ico name="book" lg />
                </span>
                <h3>كل بيعة بتصير قيد محاسبي</h3>
                <p>بدون ترحيل ولا إدخال مرتين.</p>
                <div className="jnl" role="group" aria-label="مثال توضيحي لقيد آلي">
                  <div className="jh">
                    <Ico name="book" /> قيد آلي · فاتورة بيع{' '}
                    <span className="badge b-ok">
                      <Ico name="check" /> متوازن
                    </span>
                  </div>
                  <div className="jr">
                    <b>الصندوق · ليرة</b>
                    <span className="num">500</span>
                  </div>
                  <div className="jr">
                    <b>ذمم العملاء</b>
                    <span className="num">1,680</span>
                  </div>
                  <div className="jr">
                    <b className="cr">إيراد المبيعات</b>
                    <span className="num">2,180</span>
                  </div>
                  <div className="jr tot">
                    <span>مدين = دائن</span>
                    <span className="num">2,180</span>
                  </div>
                </div>
                <div className="chain">
                  <span>بيع</span>
                  <Ico name="arrow" />
                  <span>قيد</span>
                  <Ico name="arrow" />
                  <span>دفتر الأستاذ</span>
                  <Ico name="arrow" />
                  <span>الميزانية</span>
                  <em>· مثال توضيحي</em>
                </div>
              </article>
              <article className="tile c-b">
                <span className="k">
                  <Ico name="coins" lg />
                </span>
                <h3>ليرة ودولار بسعرك</h3>
                <p>حدّد الصرف بنفسك.</p>
                <div className="rate">
                  <div>
                    <span className="mut">سعر الصرف المعتمد</span>
                    <span className="mut">بيدك</span>
                  </div>
                  <div>
                    <span className="big num">$1 = 120</span>
                    <span className="badge b-acc">ل.س</span>
                  </div>
                </div>
              </article>
              <article className="tile c-c">
                <span className="k">
                  <Ico name="wifi-off" lg />
                </span>
                <h3>النت راح؟ كمّل بيع</h3>
                <p>الفواتير تنزل أول ما يرجع الاتصال.</p>
                <div className="states">
                  <span className="badge b-warn">
                    <Ico name="wifi-off" /> بلا اتصال
                  </span>
                  <Ico name="arrow" />
                  <span className="badge b-ok">
                    <Ico name="sync" /> تمت المزامنة
                  </span>
                </div>
              </article>
              <article className="tile c-d">
                <span className="k">
                  <Ico name="truck" lg />
                </span>
                <h3>مندوبين وتوزيع</h3>
                <p>مسار وزبائن وطلبيات على جواله.</p>
                <div className="phimg">
                  <Shot name="rep" look={look} alt="مسار المندوب على الجوال" w={780} h={1688} />
                </div>
              </article>
              <article className="tile c-e">
                <span className="k">
                  <Ico name="branch" lg />
                </span>
                <h3>أكثر من فرع</h3>
                <p>«بالطريق» لحد تأكيد الاستلام.</p>
                <div className="brn">
                  <span className="n">الرئيسي</span>
                  <Ico name="arrow" />
                  <span className="badge b-warn">بالطريق</span>
                  <Ico name="arrow" />
                  <span className="n">المزة</span>
                </div>
              </article>
              <article className="tile c-f">
                <span className="k">
                  <Ico name="shield" lg />
                </span>
                <h3>صلاحيات بدقة</h3>
                <p>كل موظف حسب دوره.</p>
                <div className="perm">
                  <div>
                    <Ico name="check" />
                    الكاشير: بيع
                  </div>
                  <div className="no">
                    <Ico name="x" />
                    الكاشير: خصم كبير
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="sec" id="compare" aria-labelledby="h-compare">
          <div className="wrap grid">
            <SectionHead num="03" label="مقارنة" id="h-compare" lead="بدون أسماء. الأنماط المعروفة بالسوق.">
              سيرفا مقابل البرامج التقليدية
            </SectionHead>
            <div className="body rv">
              <table className="cmp">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="vh">المعيار</span>
                    </th>
                    <th scope="col" className="o">
                      البرامج التقليدية
                    </th>
                    <th scope="col" className="n">
                      سيرفا
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map(([what, old, ours]) => (
                    <tr key={what}>
                      <th scope="row">{what}</th>
                      <td className="o">
                        <Ico name="x" />
                        <span>{old}</span>
                      </td>
                      <td className="n">
                        <Ico name="check" />
                        <span>{ours}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="foot-note">مقارنة بالأنماط الشائعة، وليست عن برنامج بعينه.</p>
            </div>
          </div>
        </section>

        <section className="sec" id="gallery" style={{ paddingTop: 0 }} aria-labelledby="h-gallery">
          <div className="wrap grid">
            <SectionHead num="04" label="المنتج" id="h-gallery" lead="لقطات حقيقية من النظام.">
              هذا سيرفا فعلاً.
            </SectionHead>
            <div className="body gal rv">
              <div
                className="gal-tabs"
                role="tablist"
                aria-label="لقطات من النظام"
                aria-orientation="vertical"
                tabIndex={-1}
                onKeyDown={(e) => tabKeys(e, GALLERY.length, shot, setShot)}
              >
                {GALLERY.map((g, i) => (
                  <button
                    key={g.id}
                    type="button"
                    className="gt"
                    role="tab"
                    id={`tab-${g.id}`}
                    aria-controls={g.id}
                    aria-selected={i === shot}
                    tabIndex={i === shot ? 0 : -1}
                    onClick={() => setShot(i)}
                  >
                    <Ico name={g.icon} lg />
                    <div>
                      <b>{g.title}</b>
                      <span>{g.sub}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="gal-stage">
                {GALLERY.map((g, i) => (
                  <GalleryView key={g.id} item={g} active={i === shot} look={look} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="pricing" style={{ paddingTop: 0 }} aria-labelledby="h-pricing">
          <div className="wrap grid">
            <SectionHead
              num="05"
              label="الأسعار"
              id="h-pricing"
              lead="كل الميزات مفتوحة. بدون بطاقة وبدون التزام."
            >
              {trialWords(days)} مجاناً، وقرّر بعدين.
            </SectionHead>
            <div className="body rv">
              {priced.length > 0 ? (
                <>
                  <ul className="plans" style={{ ['--n' as string]: priced.length }}>
                    {priced.map((plan, i) => (
                      <li key={plan.code} className={i === mid ? 'plan hl' : 'plan'}>
                        {i === mid ? <span className="tagl">التجربة تشمل كل الميزات</span> : null}
                        <h3>{plan.name}</h3>
                        <div className="price">
                          <Money minor={plan.priceMonthlyMinor ?? 0} currency="USD" className="v num" />
                          <small>/ شهرياً</small>
                        </div>
                        <ul>
                          {limitLines(plan).map((line) => (
                            <li key={line}>
                              <Ico name="check" />
                              {line}
                            </li>
                          ))}
                        </ul>
                        <Link className={i === mid ? 'btn btn-primary' : 'btn btn-ghost'} to="/register">
                          ابدأ التجربة المجانية
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="foot-note">الأسعار بالدولار، وتدفعها بالدولار أو بالليرة عند الاشتراك.</p>
                </>
              ) : (
                <div className="plans empty">
                  <div className="plan hl">
                    <h3>السعر حسب حجم محلك</h3>
                    <p className="d">
                      جرّب {trialWords(days)} بكل الميزات، وبعدها احكينا عن محلك ونعطيك السعر المناسب.
                    </p>
                    <Link className="btn btn-primary" to="/register">
                      {startLabel}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="sec" id="faq" style={{ paddingTop: 0 }} aria-labelledby="h-faq">
          <div className="wrap grid">
            <SectionHead num="06" label="أسئلة" id="h-faq">
              أي سؤال ثاني؟
            </SectionHead>
            <div className="body faqg rv">
              <aside className="wa">
                <div className="wa-card">
                  <span className="wa-ico">
                    <Ico name="chat" lg />
                  </span>
                  {chat ? (
                    <>
                      <h3>احكينا عالواتساب</h3>
                      <p>فريق بيرد بالعربي.</p>
                      <a className="btn btn-primary" href={chat} target="_blank" rel="noreferrer">
                        <ChatLabel>افتح محادثة واتساب</ChatLabel>
                      </a>
                    </>
                  ) : (
                    <>
                      <h3>جاهز تجرّب؟</h3>
                      <p>رقم جوالك وكلمة سر، وبعدها خطوات قصيرة وتبدأ البيع.</p>
                      <Link className="btn btn-primary" to="/register">
                        أنشئ حسابك
                      </Link>
                    </>
                  )}
                </div>
              </aside>
              <div className="faq-list">
                {faqs(days).map((f, i) => (
                  <details key={f.q} open={i === 0}>
                    <summary>
                      {f.q}
                      <Ico name="plus" />
                    </summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="finalsec" aria-labelledby="h-final">
          <div className="wrap rv">
            <div className="final">
              <div className="final-copy">
                <h2 className="h2" id="h-final">
                  خلّي محلك يشتغل،
                  <br />
                  وسيرفا يكتب الحسابات.
                </h2>
                <p>{trialWords(days)} مجاناً، بدون بطاقة.</p>
              </div>
              <div className="final-cta">
                <button type="button" className="btn btn-primary btn-lg" onClick={start}>
                  {startLabel}
                </button>
                {chat ? (
                  <a className="btn btn-ghost btn-lg" href={chat} target="_blank" rel="noreferrer">
                    <ChatLabel>احكينا عالواتساب</ChatLabel>
                  </a>
                ) : (
                  <button type="button" className="btn btn-ghost btn-lg" onClick={signIn}>
                    لدي حساب
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="foot">
            <div className="fb">
              <Link className="logo" to="/" aria-label="سيرفا">
                <img src="/favicon.svg" alt="" width={36} height={36} loading="lazy" />
                <span className="logo-t" aria-hidden="true">
                  <b>SERVA</b>
                  <i>سيرفا</i>
                </span>
              </Link>
              <p>كاشير سحابي ومحاسبة مزدوجة آلية للمحلات في سوريا.</p>
            </div>
            <nav aria-label="المنتج">
              <h2 className="h6">المنتج</h2>
              <a href="#sectors">القطاعات</a>
              <a href="#why">الفرق</a>
              <a href="#gallery">لقطات</a>
            </nav>
            <nav aria-label="الشركة">
              <h2 className="h6">الشركة</h2>
              <a href="#pricing">الأسعار</a>
              <a href="#faq">أسئلة شائعة</a>
              {chat ? (
                <a href={chat} target="_blank" rel="noreferrer">
                  واتساب
                </a>
              ) : null}
            </nav>
            <nav aria-label="قانوني">
              <h2 className="h6">قانوني</h2>
              <Link to="/terms">الشروط</Link>
              <Link to="/privacy">الخصوصية</Link>
            </nav>
          </div>
          <div className="copy">
            <span>© سيرفا · جميع الحقوق محفوظة</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
