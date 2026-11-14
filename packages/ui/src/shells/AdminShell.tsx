import * as RadixDialog from '@radix-ui/react-dialog';
import { useDirection } from '@radix-ui/react-direction';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '../cn';
import { CONTROL_HEIGHT, type PolymorphicProps } from '../context';
import { CloseIcon } from '../icons';
import { Tooltip } from '../Tooltip';

/** What the sidebar's content is drawn as: the full panel, or folded to a rail of icons. */
export interface AdminSidebarState {
  /** Folded to a rail of icons (from 1024 px). The phone's drawer is never folded. */
  collapsed: boolean;
}

const SidebarContext = createContext<AdminSidebarState>({ collapsed: false });

export interface AdminShellProps {
  /**
   * The sidebar: logo, navigation, plan. On the start side (the right in Arabic), from 1024 px; under
   * it, in the drawer. A function draws it for its place: `({ collapsed }) => …`.
   */
  sidebar: ReactNode | ((state: AdminSidebarState) => ReactNode);
  /** The top bar's content: where you are, search, notices, the account. */
  topBar: ReactNode;
  /** A second row of the sticky header, over a hairline: the section's tabs. */
  subBar?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  /** Fill the parent instead of the screen: previews and the component gallery. */
  framed?: boolean;
  /** From 1024 px: the sidebar folded to a 72 px rail of icons; each link shows its words in a hint. */
  collapsed?: boolean;
  /** Under 1024 px: the sidebar opened as a drawer from the start side. */
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  /** The drawer's name for screen readers. */
  drawerLabel?: string;
}

/** Where the drawer stops existing: the sidebar shows beside the page from here (Tailwind's lg). */
const DESKTOP = '(min-width: 64rem)';

/** True once the page (or the framed box) has scrolled: the top bar then draws its edge. */
function useScrolled(root: RefObject<HTMLElement | null>, framed: boolean): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const box = framed ? root.current : null;
    const read = () => setScrolled((box ? box.scrollTop : window.scrollY) > 0);
    read();
    const target: HTMLElement | Window = box ?? window;
    target.addEventListener('scroll', read, { passive: true });
    return () => target.removeEventListener('scroll', read);
  }, [root, framed]);
  return scrolled;
}

/**
 * The store admin and panels layout (هوية 4): the deep-emerald sidebar floating on the start side
 * (264 px, or a 72 px rail of icons when folded), a sticky top bar that blurs the page scrolling
 * under it, the section's tabs under it, and the content at most 1320 wide. Under 1024 the sidebar
 * hides and opens as a drawer from the same side.
 */
export function AdminShell({
  sidebar,
  topBar,
  subBar,
  children,
  contentClassName,
  framed = false,
  collapsed = false,
  drawerOpen = false,
  onDrawerOpenChange,
  drawerLabel = 'القائمة',
}: AdminShellProps) {
  const root = useRef<HTMLDivElement>(null);
  const scrolled = useScrolled(root, framed);
  const draw = (state: AdminSidebarState) => (typeof sidebar === 'function' ? sidebar(state) : sidebar);

  // A window widened past 1024 shows the sidebar beside the page: the drawer has no place there.
  useEffect(() => {
    if (!drawerOpen || typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia(DESKTOP);
    const close = () => {
      if (desktop.matches) onDrawerOpenChange?.(false);
    };
    close();
    desktop.addEventListener('change', close);
    return () => desktop.removeEventListener('change', close);
  }, [drawerOpen, onDrawerOpenChange]);

  return (
    <div ref={root} className={cn(framed ? 'h-full overflow-auto' : 'min-h-dvh', 'flex bg-canvas')}>
      <aside
        className={cn(
          framed ? 'h-full' : 'h-dvh',
          'sticky top-0 hidden shrink-0 py-2 ps-2 motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-standard lg:flex',
          collapsed ? 'w-18' : 'w-66',
        )}
      >
        {/* هوية 4: SERFA's signature, a deep-emerald panel in both modes, floating on the page. */}
        <div className="flex min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto rounded-panel bg-sidebar p-3 text-sidebar-ink shadow-e2 ring-1 ring-sidebar-line scheme-dark [scrollbar-width:thin]">
          <SidebarContext value={{ collapsed }}>{draw({ collapsed })}</SidebarContext>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'sticky top-0 z-20 bg-canvas/80 backdrop-blur-xl',
            // With tabs under it, their full-width hairline is the bar's edge; alone, it shows once
            // the page scrolls under it.
            !subBar && 'border-b transition-[border-color] duration-200 ease-standard',
            !subBar && (scrolled ? 'border-line' : 'border-transparent'),
          )}
        >
          <div className="@container mx-auto flex h-16 w-full max-w-330 items-center gap-3 px-4 sm:px-6 lg:h-18 lg:px-8">
            {topBar}
          </div>
          {subBar ? (
            <div className="border-b border-line">
              <div className="mx-auto w-full max-w-330 px-4 sm:px-6 lg:px-8">{subBar}</div>
            </div>
          ) : null}
        </header>
        <main
          className={cn(
            'mx-auto w-full max-w-330 flex-1 px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8',
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
      <SidebarDrawer open={drawerOpen} onOpenChange={onDrawerOpenChange} label={drawerLabel}>
        {draw({ collapsed: false })}
      </SidebarDrawer>
    </div>
  );
}

/** A square icon button on the deep-emerald panel: 40, 48 under a finger. */
function SidebarIconButton({
  label,
  icon,
  className,
  type = 'button',
  ...rest
}: Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & { label: string; icon: ReactNode }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-control text-sidebar-muted transition-colors duration-120 ease-standard hover:bg-sidebar-hover hover:text-sidebar-strong focus-visible:outline-sidebar-brand pointer-coarse:size-12',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}

/**
 * The sidebar on a phone or a tablet (هوية 4 › Sheet, in the sidebar's skin): from the start side
 * over the dimmed page, the panel radius on the corners facing it. Esc, the close button, a tap
 * outside or a chosen page close it.
 */
function SidebarDrawer({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: ((open: boolean) => void) | undefined;
  label: string;
  children: ReactNode;
}) {
  const dir = useDirection();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] motion-safe:animate-fade" />
        <RadixDialog.Content
          dir={dir}
          aria-describedby={undefined}
          // A chosen link closes the drawer, the open page's own too (no address change to wait for).
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a[href]')) onOpenChange?.(false);
          }}
          className={cn(
            'fixed inset-y-0 start-0 z-40 flex w-72 max-w-[calc(100vw-3rem)] flex-col overflow-y-auto rounded-e-panel bg-sidebar px-3 pt-5 pb-3 text-sidebar-ink shadow-e3 scheme-dark',
            // The side sheet's own entrance, from the start side instead of the end.
            '[--sheet-from:1] motion-safe:animate-sheet-in ltr:[--sheet-from:-1]',
          )}
        >
          <RadixDialog.Title className="sr-only">{label}</RadixDialog.Title>
          <RadixDialog.Close asChild>
            <SidebarIconButton
              label="أغلق القائمة"
              icon={<CloseIcon />}
              className="absolute end-3 top-4 pointer-coarse:top-3"
            />
          </RadixDialog.Close>
          <SidebarContext value={{ collapsed: false }}>{children}</SidebarContext>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * A sidebar link's look (هوية 4 › Sidebar): 40 high (48 under a finger), the words in sidebar-ink;
 * the open page on sidebar-active in white and semibold. For a router NavLink:
 * `className={({ isActive }) => navItemClass(isActive)}`.
 */
export function navItemClass(active: boolean): string {
  return cn(
    'group/nav relative flex items-center gap-3 rounded-control px-2.5 text-[0.9375rem] whitespace-nowrap transition-colors duration-120 ease-standard focus-visible:outline-sidebar-brand',
    CONTROL_HEIGHT.comfortable,
    active
      ? 'bg-sidebar-active font-semibold text-sidebar-strong'
      : 'text-sidebar-ink hover:bg-sidebar-hover hover:text-sidebar-strong',
  );
}

/**
 * A sidebar link with its icon and an optional count («بانتظارك 3»). The open page carries the
 * brand's 3 px bar on the panel's start edge (the one gradient of the sidebar). On the folded rail
 * only the icon shows; the words stay for screen readers and show in a hint on hover and focus.
 */
export function NavItem<C extends ElementType = 'a'>({
  as,
  active = false,
  icon,
  count,
  className,
  children,
  ...rest
}: PolymorphicProps<
  C,
  { active?: boolean; icon?: ReactNode; count?: number; className?: string; children: ReactNode }
>) {
  const { collapsed } = useContext(SidebarContext);
  const Component: ElementType = as ?? 'a';
  return (
    <Tooltip content={collapsed ? children : null} side="end">
      <Component
        aria-current={active ? 'page' : undefined}
        className={cn(navItemClass(active), className)}
        {...rest}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-2 -start-3 w-0.75 rounded-e-full bg-linear-to-b from-sidebar-brand to-accent"
          />
        ) : null}
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              'relative flex shrink-0 transition-colors duration-120 ease-standard',
              active ? 'text-sidebar-brand' : 'text-sidebar-muted group-hover/nav:text-sidebar-ink',
            )}
          >
            {icon}
            {collapsed && count ? (
              <span className="absolute -end-1 -top-1 size-2.5 rounded-full bg-sidebar-brand ring-2 ring-sidebar" />
            ) : null}
          </span>
        ) : null}
        <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{children}</span>
        {count ? (
          <span
            className={
              collapsed
                ? 'sr-only'
                : 'num min-w-5.5 rounded-full bg-sidebar-brand px-1.5 text-center text-xs/5.5 font-bold text-sidebar'
            }
          >
            {count}
          </span>
        ) : null}
      </Component>
    </Tooltip>
  );
}

/**
 * A titled group of sidebar links (هوية 4 › Sidebar: the label in sidebar-muted, 12 semibold). On
 * the folded rail a short hairline takes the label's place, at the same height, so nothing moves.
 */
export function NavGroup({ label, children }: { label?: string; children: ReactNode }) {
  const { collapsed } = useContext(SidebarContext);
  const labelId = useId();
  return (
    <div className="flex flex-col">
      {label ? (
        <div className="flex h-10 items-end pb-2">
          <p
            id={labelId}
            className={
              collapsed
                ? 'sr-only'
                : 'truncate px-2.5 text-xs font-semibold whitespace-nowrap text-sidebar-muted'
            }
          >
            {label}
          </p>
          {collapsed ? <span aria-hidden="true" className="mx-auto mb-1 h-px w-5 bg-sidebar-line" /> : null}
        </div>
      ) : null}
      <ul aria-labelledby={label ? labelId : undefined} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}
