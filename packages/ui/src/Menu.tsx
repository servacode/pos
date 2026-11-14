import { useDirection } from '@radix-ui/react-direction';
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { CheckIcon } from './icons';
import { floatingRoot, mergeRefs, useAnchoredBox } from './Tooltip';

// The menu button pattern (WAI-ARIA APG): the trigger has aria-haspopup="menu" and aria-expanded;
// click, Enter, Space or ↓ open the menu on its first item (↑ on its last); ↑ ↓ Home End move; Esc,
// Tab, a click outside or choosing an item close it and give focus back to the trigger.

/** The items the keyboard visits, in order. */
const ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])';

interface MenuContextValue {
  /** Closes the menu, gives focus back to the trigger, then runs the chosen item's action. */
  select: (action?: () => void) => void;
  /** The pointer left the items: no item stays highlighted, focus stays in the menu. */
  release: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

type TriggerProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> };

export interface MenuProps {
  /**
   * The control that opens it: a Button, an IconButton or a <button> (a Tooltip around one works
   * too). It gets aria-haspopup, aria-expanded and its open-close handlers.
   */
  trigger: ReactElement;
  /** The menu's name for screen readers («حسابي», «المظهر»). */
  label: string;
  /** MenuItem, MenuGroup (items under a heading), MenuSeparator and MenuLabel. */
  children: ReactNode;
  /** The trigger's edge it lines up with, in the reading direction (start is the right in Arabic). */
  align?: 'start' | 'end';
  /** Under the trigger (default) or above it; it flips when there is no room. */
  side?: 'bottom' | 'top';
  /** Controlled open state; leave out to let the menu keep its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra classes for the panel, e.g. a width (`w-72`). */
  className?: string;
}

/**
 * A dropdown of actions or links (هوية 4 › Menu): the account menu, «المزيد», the theme switch. A
 * floating card under its trigger, kept inside the window and inside an open dialog.
 *
 * ```tsx
 * <Menu label="حسابي" align="end" trigger={<Button variant="ghost">سارة</Button>}>
 *   <MenuGroup label="مديرة · بوتيك الأناقة">
 *     <MenuItem icon={<KeyIcon />} render={(props) => <Link to="/me/pin" {...props} />}>رمز الدخول</MenuItem>
 *   </MenuGroup>
 *   <MenuSeparator />
 *   <MenuItem icon={<LogoutIcon />} tone="danger" onSelect={logout}>تسجيل الخروج</MenuItem>
 * </Menu>
 * ```
 */
export function Menu({
  trigger,
  label,
  children,
  align = 'start',
  side = 'bottom',
  open: openProp,
  onOpenChange,
  className,
}: MenuProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const dir = useDirection();
  const menuId = useId();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openOn = useRef<'first' | 'last'>('first');

  // The listeners below outlive a render; they read the latest props from here.
  const latest = useRef({ controlled: openProp !== undefined, onOpenChange });
  useLayoutEffect(() => {
    latest.current = { controlled: openProp !== undefined, onOpenChange };
  });

  const setOpen = useCallback((next: boolean) => {
    if (!latest.current.controlled) setOwnOpen(next);
    latest.current.onOpenChange?.(next);
  }, []);

  const focusTrigger = useCallback(() => triggerRef.current?.focus({ preventScroll: true }), []);

  /**
   * 'trigger': focus goes back to the trigger now (Esc, Tab, a choice). 'if-lost': a click outside
   * keeps the focus it gave to what was clicked, and only a click on nothing returns it.
   */
  const close = useCallback(
    (focus: 'trigger' | 'if-lost') => {
      setOpen(false);
      if (focus === 'trigger') {
        focusTrigger();
        return;
      }
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) focusTrigger();
      }, 0);
    },
    [setOpen, focusTrigger],
  );

  const items = useCallback(
    () => (listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>(ITEMS)] : []),
    [],
  );

  const focusEdge = useCallback(
    (edge: 'first' | 'last') => {
      const all = items();
      (edge === 'last' ? all.at(-1) : all[0])?.focus();
    },
    [items],
  );

  // Inside an open dialog the menu mounts in it; elsewhere on the body.
  useLayoutEffect(() => {
    if (open) setRoot(floatingRoot(triggerRef.current));
  }, [open]);

  const shown = open && root !== null;
  useAnchoredBox(shown, triggerRef, boxRef, { side, align, gap: 6, dir });

  useLayoutEffect(() => {
    if (!shown) return;
    const all = items();
    const target = openOn.current === 'last' ? all.at(-1) : all[0];
    (target ?? listRef.current)?.focus({ preventScroll: true });
    openOn.current = 'first';
  }, [shown, items]);

  useEffect(() => {
    if (!shown) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (boxRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return;
      }
      close('if-lost');
    };
    // Esc closes the menu and only the menu: not a dialog around it, nor a screen's own Esc key.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      close('trigger');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [shown, close]);

  const context = useMemo<MenuContextValue>(
    () => ({
      select: (action) => {
        close('trigger');
        action?.();
      },
      release: () => listRef.current?.focus({ preventScroll: true }),
    }),
    [close],
  );

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const current = all.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % all.length;
        break;
      case 'ArrowUp':
        next = current < 0 ? all.length - 1 : (current - 1 + all.length) % all.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = all.length - 1;
        break;
      case 'Tab':
        // Focus goes back to the trigger first, so Tab moves on from there in the page.
        close('trigger');
        return;
      case ' ': {
        // Space chooses a link item too; a <button> item does it by itself.
        const target = event.target as HTMLElement;
        if (target.tagName !== 'BUTTON' && target.getAttribute('role')?.startsWith('menuitem')) {
          event.preventDefault();
          target.click();
        }
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    all[next]?.focus();
  };

  const triggerProps = trigger.props as TriggerProps;
  const triggerRefProp = triggerProps.ref;
  const ref = useMemo(() => mergeRefs(triggerRefProp, triggerRef), [triggerRefProp]);
  const triggerElement = cloneElement(trigger as ReactElement<TriggerProps>, {
    ref,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': shown ? menuId : undefined,
    onClick: (event: MouseEvent<HTMLElement>) => {
      triggerProps.onClick?.(event);
      if (event.defaultPrevented) return;
      if (open) {
        close('trigger');
        return;
      }
      openOn.current = 'first';
      setOpen(true);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      triggerProps.onKeyDown?.(event);
      if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      event.preventDefault();
      const edge = event.key === 'ArrowUp' ? 'last' : 'first';
      if (shown) {
        focusEdge(edge);
        return;
      }
      openOn.current = edge;
      setOpen(true);
    },
  });

  return (
    <>
      {triggerElement}
      {shown
        ? createPortal(
            <div ref={boxRef} dir={dir} className="fixed start-0 top-0 z-50">
              <div
                ref={listRef}
                id={menuId}
                role="menu"
                aria-label={label}
                tabIndex={-1}
                onKeyDown={onListKeyDown}
                className={cn(
                  'flex max-h-[calc(100dvh-1rem)] max-w-[min(20rem,calc(100vw-1rem))] min-w-48 flex-col overflow-y-auto rounded-card border border-line bg-surface p-1.5 text-ink shadow-e3 outline-none motion-safe:animate-rise',
                  className,
                )}
              >
                <MenuContext value={context}>{children}</MenuContext>
              </div>
            </div>,
            root,
          )
        : null}
    </>
  );
}

// ── Items ───────────────────────────────────────────────────────────────────────────────────────

// Items (هوية 4 › Menu): 36 high with a mouse, 48 under a finger; the highlight follows the pointer
// and the arrow keys alike, and the keyboard also draws the focus ring, inset so the panel never
// clips it. Only the fill and the text colour animate: the ring shows at once, in its own colour.
const ITEM =
  'flex min-h-9 w-full items-center gap-2.5 rounded-small px-2.5 text-start text-[0.9375rem] transition-[background-color,color] duration-120 ease-standard select-none focus-visible:-outline-offset-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 pointer-coarse:min-h-12';
const TONES = {
  default: 'text-ink hover:bg-surface-muted focus:bg-surface-muted',
  danger: 'text-danger-ink hover:bg-danger-soft focus:bg-danger-soft',
} as const;

/** What a `render` item hands to its element (spread them all on it, e.g. a router Link). */
export interface MenuItemRenderProps {
  role: 'menuitem' | 'menuitemradio';
  tabIndex: -1;
  className: string;
  'aria-checked'?: boolean;
  'aria-disabled'?: true;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  children: ReactNode;
}

export interface MenuItemProps {
  /** The item's words: what it does or where it goes. */
  children: ReactNode;
  /** A 20 px icon before the words. */
  icon?: ReactNode;
  /** Runs when the item is chosen (click, Enter, Space), after the menu closes. */
  onSelect?: () => void;
  /** Makes the item a link (<a href>). */
  href?: string;
  /** Draws the item with another element, e.g. a router link: `render={(props) => <Link to="/x" {...props} />}`. */
  render?: (props: MenuItemRenderProps) => ReactElement;
  /** 'danger' for a destructive action («تسجيل الخروج», «احذف»). */
  tone?: keyof typeof TONES;
  disabled?: boolean;
  /** One choice of a set (the theme): the item becomes a menuitemradio and shows a check when on. */
  checked?: boolean;
  /** A keyboard shortcut shown at the end («Alt+R»). */
  shortcut?: string;
  /** Anything else at the end: a count, a plan badge. */
  trailing?: ReactNode;
  className?: string;
}

/** One action or link of a Menu. */
export function MenuItem({
  children,
  icon,
  onSelect,
  href,
  render,
  tone = 'default',
  disabled = false,
  checked,
  shortcut,
  trailing,
  className,
}: MenuItemProps) {
  const menu = useContext(MenuContext);
  const props: MenuItemRenderProps = {
    role: checked === undefined ? 'menuitem' : 'menuitemradio',
    tabIndex: -1,
    ...(checked === undefined ? {} : { 'aria-checked': checked }),
    ...(disabled ? { 'aria-disabled': true as const } : {}),
    className: cn(ITEM, TONES[tone], className),
    onClick: (event) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      if (menu) menu.select(onSelect);
      else onSelect?.();
    },
    onPointerMove: (event) => {
      if (event.pointerType === 'touch' || disabled || document.activeElement === event.currentTarget) return;
      event.currentTarget.focus({ preventScroll: true });
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== 'touch') menu?.release();
    },
    children: (
      <>
        {icon ? (
          <span aria-hidden="true" className={cn('flex shrink-0', tone === 'default' && 'text-ink-muted')}>
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {trailing}
        {shortcut ? (
          <kbd dir="ltr" className="shrink-0 font-sans text-xs text-ink-subtle">
            {shortcut}
          </kbd>
        ) : null}
        {checked ? <CheckIcon size={16} className="text-brand-ink" /> : null}
      </>
    ),
  };
  if (render) return render(props);
  const { children: content, ...attributes } = props;
  if (href !== undefined) {
    return (
      <a href={href} {...attributes}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" {...attributes}>
      {content}
    </button>
  );
}

/** A hairline between groups of items. */
export function MenuSeparator() {
  return <div role="separator" className="-mx-1.5 my-1 h-px bg-line" />;
}

/**
 * A small heading, not focusable. Give it as a MenuGroup's `label` so screen readers hear it too:
 * on its own it is only seen, as focus moves from item to item and never lands on it.
 */
export function MenuLabel({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  /** For aria-labelledby; MenuGroup sets it. */
  id?: string;
}) {
  return (
    <div id={id} className={cn('px-2.5 pt-2 pb-1 text-xs font-semibold text-ink-subtle', className)}>
      {children}
    </div>
  );
}

export interface MenuGroupProps {
  /** The heading over the items («مديرة · بوتيك الأناقة», «المظهر»): shown, and read as the group's name. */
  label: ReactNode;
  /** The group's MenuItems. */
  children: ReactNode;
  className?: string;
}

/**
 * Items under a heading (WAI-ARIA APG: a group in a menu, labelled by its visible heading): the
 * account menu's header (who is signed in, in which store) over its items, or a section of a long
 * menu. Screen readers say the heading when focus enters the group. The arrow keys go through
 * groups as through one list.
 */
export function MenuGroup({ label, children, className }: MenuGroupProps) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={cn('flex flex-col', className)}>
      <MenuLabel id={labelId}>{label}</MenuLabel>
      {children}
    </div>
  );
}
