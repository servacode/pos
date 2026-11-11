# SERFA — هوية 4 «الزمرّدي» (the design language)

The visual identity every screen of SERFA follows: the store admin, the cashier, the platform panel
and the online shop. Tokens live once in `packages/ui/src/theme.css` (values from
`docs/design/kit/serva-ui.css` and `addon-dark.css`; `theme.test.ts` checks every value and the
contrast of every allowed pair). Components live in `packages/ui/src`. Screens compose components;
they never restyle them with raw colours.

The reference board (light and dark side by side) is the approved specimen: every recipe below is
drawn there.

## Character

Calm, precise, premium. Generous white space, hairline borders, soft layered shadows, one strong
colour (emerald) used with intent, numbers that line up. Quality bar: Linear, Stripe, Vercel — never
a copy of them, never a generic admin template. Beauty never costs the cashier speed.

## Colour (token names only — never a palette shade or a hex in a screen)

| Role | Tokens | Use |
| --- | --- | --- |
| Page | `canvas` | the page behind cards |
| Surfaces | `surface`, `surface-muted`, `surface-total` | cards, inputs, menus · hover fills, chips, table header, segmented track · the cashier total |
| Lines | `line`, `line-control` | card and row dividers (soft) · input, checkbox and select borders (3:1, WCAG 1.4.11) |
| Text | `ink`, `ink-muted`, `ink-subtle` | primary · secondary (labels, descriptions) · tertiary (hints, column heads, placeholders) |
| Brand | `brand`, `brand-hover`, `on-brand`, `brand-soft`, `brand-ink`, `ring` | primary actions, selection, focus. `brand-ink` is brand-coloured *text*; `brand-soft` a tinted fill |
| Accent | `accent`, `on-accent`, `accent-soft`, `accent-ink` | teal, sparingly: the second series in a chart, a highlight chip, the gradient end of the logo |
| Status | `success|warning|danger|info` + `-soft` + `-ink`, `on-danger` | state only, always with an icon or a word |
| Sidebar | `sidebar`, `sidebar-hover`, `sidebar-active`, `sidebar-line`, `sidebar-ink`, `sidebar-muted`, `sidebar-strong`, `sidebar-brand` | the deep-emerald sidebar, the same in both modes: SERFA's signature |
| Fixed | `mark-from`, `mark-to`, `on-mark`, `highlight` | the same in both modes: the logo mark (emerald → teal, white «S»), the primary button's shadow (`mark-from/30`) and the light along a raised button's top edge |
| Overlay | `overlay` | behind dialogs and sheets |

Rules: text on a tinted fill uses the matching `-ink` (`text-brand-ink` on `bg-brand-soft`). Status
colours never decorate. Gradients only in the logo mark, the active-nav indicator
(`from-sidebar-brand to-accent`) and the hero KPI band — nowhere else.

## Charts

Series colours `chart-1` … `chart-6`, in this fixed order, never cycled, never generated:
emerald (the brand), blue, orange, violet, magenta, amber. Validated with the data-viz checker in both
modes (lightness band, chroma, colour-blind separation, normal-vision floor); slots 5 and 6 sit under
3:1 on white, so every chart labels its values or offers a table view. A single series is
`chart-1` with no legend; two or more get a legend, and up to four are labelled directly. One axis
only; thin 2 px lines, 4 px rounded bar ends on the baseline, 2 px surface gaps between fills,
recessive grid (`line`), text in ink tokens (never the series colour). Every chart has a hover
tooltip. Status colours are never series colours. Time runs right to left, as tables and progress
bars do: the oldest day on the right, the latest at the inline end (the left in Arabic); sparklines
and trend arrows follow the same direction.

## Dark mode

`data-theme="light" | "dark"` on `<html>`; no attribute follows the device. Dark mode is for
screens only: receipts, labels and reports always print in the light colours (dark ink on white). Every component reads
tokens, so dark mode needs no `dark:` classes except where a token cannot express it. Dark surfaces
are charcoal with a breath of green; emerald is lighter and used with restraint.

## Type

IBM Plex Sans Arabic, three weights only: 400, 600, 700 (`font-normal`, `font-semibold`,
`font-bold`). Every amount, quantity, document number, phone, date and percent gets the `num`
utility (tabular digits inside a direction isolate).

| Step | Class | Use |
| --- | --- | --- |
| Display | `text-3xl font-bold` (30) | dashboard greeting, empty hero |
| Page title | `text-2xl font-bold` (24) | one per page (`PageHeader`) |
| Section | `text-lg font-semibold` (18) | card titles |
| Body | `text-base` (16) / `text-[0.9375rem]` (15) | text, menu items |
| Small | `text-sm` (14) | table cells, controls on compact screens, descriptions |
| Caption | `text-xs font-semibold` (12) | column heads, badges, group labels |
| KPI | `text-kpi font-bold num` (30) | stat tiles |
| Total | `text-total font-bold num` (40) | the cashier total |

## Shape and depth

| Token | Value | Use |
| --- | --- | --- |
| `rounded-box` | 5 | the boxes of checkboxes and toggle chips (8 on a 16–20 box reads as a radio) |
| `rounded-small` | 8 | chips, tags, menu items, kbd, small thumbnails |
| `rounded-control` | 10 | buttons, inputs, selects, segmented controls, icon buttons |
| `rounded-card` | 16 | cards, tables, tiles, popovers, menus, toasts |
| `rounded-panel` | 20 | dialogs, sheets, the sidebar panel |
| `rounded-full` | — | badges, counts, avatars, switches only |
| `shadow-e1` | hairline lift | cards and secondary buttons (with `border-line`) |
| `shadow-e2` | raised | hovered cards, popovers, menus |
| `shadow-e3` | floating | dialogs, sheets, toasts |

Cards: `rounded-card border border-line bg-surface shadow-e1`. Never a shadow without the hairline in
light mode; dark mode leans on the border.

## Size (density, `packages/ui/src/context.tsx`)

| Density | Controls | Rows | Where |
| --- | --- | --- | --- |
| touch | 56 | 56 | the cashier, waiter, phone flows |
| comfortable | 40, **48 on a coarse pointer** | 48 | the store admin (default) |
| compact | 36, 44 on a coarse pointer | 40 | the platform panel, long lists |
| dense | 32 | 32 | accountant screens, mouse only |

Use `CONTROL_HEIGHT[density]` / `ROW_HEIGHT[density]` / `HEAD_ROW_HEIGHT[density]` (table heads, a
step lower than a row); never hard-code a control height. Touch targets are never under 48 × 48 on a
finger (`pointer-coarse:`); on the touch density, choice controls (chips, choice cards, switches)
take its 56.

## Components (recipes)

- **Button**: `rounded-control`, semibold, icon 18–20 before the label. *Primary* `bg-brand
  text-on-brand` + an inset top `highlight/15` + a small `mark-from/30` shadow, hover `bg-brand-hover`.
  *Secondary* `bg-surface text-ink border border-line-control/50 shadow-e1`, hover
  `bg-surface-muted`. *Ghost* `text-ink-muted`, hover `bg-surface-muted text-ink`. *Danger*
  `bg-danger text-on-danger`; *danger-soft* `bg-danger-soft text-danger-ink`. Pressed `scale-[0.98]`.
  Focus: the global `:focus-visible` ring. Pay button (cashier): 72 high, `rounded-card`, label at the
  start, amount at the end.
- **Fields**: label `text-sm font-semibold text-ink-muted` above; control `rounded-control
  bg-surface border border-line-control`, placeholder `ink-subtle`; focus `border-brand` + `ring-4
  ring-brand/15`; error `border-danger` + `ring-4 ring-danger/15` and a `danger-ink` message with an
  icon (focused, an error field takes the global focus ring again); hint `text-sm text-ink-subtle`. Leading icon `ink-subtle`. Units (ل.س, $) at the end in
  `ink-subtle`. Autofill keeps the surface colour.
- **Select / dropdown**: same box as a field, chevron at the end.
- **Checkbox / radio / switch**: 20 boxes (`rounded-box`), `border-line-control`, checked `bg-brand`
  with an `on-brand` mark; switch track `surface-muted` → `brand`.
- **Segmented control / pill tabs**: track `bg-surface-muted p-1 rounded-control`, active segment
  `bg-surface text-ink shadow-e1`, others `text-ink-muted`.
- **Underline tabs** (page sections): `border-b border-line`, active `border-b-2 border-brand
  text-ink font-semibold`, others `text-ink-muted hover:text-ink`.
- **Card / CardHeader**: padding 20–24; header = optional 36 icon tile (`rounded-small
  bg-brand-soft text-brand-ink`), title `text-lg font-semibold`, description `text-sm
  text-ink-muted`, actions at the end.
- **StatTile (KPI)**: label `text-sm text-ink-muted`, value `text-kpi font-bold num`, unit
  `text-sm font-semibold text-ink-subtle`, trend pill (`success-soft/success-ink` ▲, `danger-soft/
  danger-ink` ▼), optional sparkline.
- **DataTable**: inside a card shell (`rounded-card border border-line overflow-hidden`); header row
  `bg-surface-muted/60 text-xs font-semibold text-ink-subtle`; rows `ROW_HEIGHT`, `border-b
  border-line`, hover `bg-surface-muted/60`, selected `bg-brand-soft`; numbers `text-end num`; the
  first column semibold `ink`; a totals row `bg-surface-total font-bold`.
- **Badge / status chip**: `rounded-full px-2.5 py-0.5 text-xs font-semibold` + a 6 px dot in
  `currentColor`; tones: success, warning, danger, info, neutral (`surface-muted/ink-muted`), brand.
- **Alert / banner**: `rounded-card` tinted fill of the tone, the tone's icon, title semibold, body
  `-ink`.
- **Empty state**: `rounded-card border border-dashed border-line-control/50`, centred: 48 icon tile
  (`rounded-card bg-brand-soft text-brand`), title semibold, one line `ink-muted`, one action.
- **Skeleton**: `rounded-small bg-surface-muted animate-skeleton`.
- **Dialog**: `rounded-panel bg-surface shadow-e3 p-6`, title `text-lg font-semibold`, actions at
  the end (safe one first); overlay `bg-overlay backdrop-blur-[2px]`.
- **Sheet**: the same skin from the inline end (left in Arabic) or the bottom on a phone.
- **Toast**: inverted (`bg-ink text-surface`), `rounded-card shadow-e3`, a status icon disc.
- **Tooltip**: `bg-ink text-surface text-xs font-semibold rounded-small px-2 py-1 shadow-e2`, after
  ~300 ms on hover, at once on keyboard focus; never the only way to learn something.
- **Menu (dropdown)**: `rounded-card border border-line bg-surface shadow-e3 p-1.5`; items
  `rounded-small px-2.5 min-h-9 text-[0.9375rem]` hover `bg-surface-muted`; destructive items
  `text-danger-ink hover:bg-danger-soft`; separators `h-px bg-line my-1`; arrow keys, Home/End, Esc,
  type-ahead not required.
- **Avatar**: `rounded-full`, initials `font-bold` on `brand-soft/brand-ink`.
- **Logo**: the emerald mark (gradient `mark-from → mark-to`, the «S» in `on-mark`, white; the same
  in both modes) + the wordmark «SERFA» (Latin, bold, letter-spaced) + «سيرفا» small under it.

## Motion

`duration-120 ease-standard` for hover and press; 200 for popovers, menus and dialogs (`animate-rise`,
`animate-fade`); 320 for sheets. Everything wrapped in `motion-safe:`. No bouncing, no parallax.

## RTL

Logical properties only: `ms-/me-/ps-/pe-/start-/end-/text-start/text-end`, never left/right.
Directional icons (back, next, chevrons that mean «go on») flip with `rtl:-scale-x-100`; others never
flip. Numbers, codes and Latin words sit in their own isolate (`num`, `dir="ltr"`, `<bdi>`).

## Never

Raw colours or palette shades in screens · new font weights · pills for buttons · shadows without a
hairline in light mode · colour as the only signal · fixed pixel heights instead of the density
tokens · renaming a button, link or label a test or a user relies on.
