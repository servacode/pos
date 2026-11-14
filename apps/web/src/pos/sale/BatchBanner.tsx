import { Button, KeyIcon, WarningIcon } from '@serva/ui';
import type { BatchIssue, StockIssue } from './batches';

/**
 * What the cart cannot take as it stands (03 › الصيدليات): lines no valid batch covers, and items
 * it takes more of than the branch holds. A refused line blocks the sale; one that waits for a
 * manager shows the manager code; a stock shortfall only warns, unless the store forbids it.
 */
export function BatchBanner(props: {
  blocks: readonly BatchIssue[];
  approvals: readonly BatchIssue[];
  stockBlocks: readonly StockIssue[];
  stockWarns: readonly StockIssue[];
  /** Quantity text for base units */
  fmt: (qty: number) => string;
  onApprove: () => void;
}) {
  const { fmt } = props;
  const why = (i: BatchIssue) =>
    i.expiredQty > 0 || i.blockedQty > 0
      ? ` (${[i.expiredQty > 0 ? 'دفعات منتهية' : '', i.blockedQty > 0 ? 'دفعات موقوفة' : ''].filter(Boolean).join(' و')} لا تُباع)`
      : '';
  const rows: { tone: 'danger' | 'warning'; text: string; key: string }[] = [
    ...props.blocks.map((i) => ({
      tone: 'danger' as const,
      key: `b${i.lineNo}`,
      text:
        i.blockedQty > 0
          ? `«${i.name}»: فيه دفعة موقوفة بسبب سحب من السوق (استدعاء)، وينقص ${fmt(i.uncovered)} من الصالح. لا يُباع ولا يُتجاوز برمز المدير.`
          : `لا دفعة صالحة تكفي «${i.name}»: ينقص ${fmt(i.uncovered)}${why(i)}. لا يُباع بلا دفعة صالحة.`,
    })),
    ...props.approvals.map((i) => ({
      tone: 'warning' as const,
      key: `a${i.lineNo}`,
      text: `لا دفعة صالحة تكفي «${i.name}»: ينقص ${fmt(i.uncovered)}${why(i)}. يلزم رمز المدير.`,
    })),
    ...props.stockBlocks.map((i) => ({
      tone: 'danger' as const,
      key: `s${i.variantId}`,
      text: `«${i.name}»: الموجود ${fmt(i.onHand)} فقط والمطلوب ${fmt(i.wanted)}. لا يُباع فوق المخزون.`,
    })),
    ...props.stockWarns.map((i) => ({
      tone: 'warning' as const,
      key: `w${i.variantId}`,
      text: `«${i.name}»: الموجود ${fmt(i.onHand)} فقط والمطلوب ${fmt(i.wanted)}.`,
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div
          key={r.key}
          role="alert"
          className={
            r.tone === 'danger'
              ? 'flex items-center gap-3 rounded-card border border-danger/20 bg-danger-soft py-2 ps-3 pe-2 text-sm font-semibold text-danger-ink'
              : 'flex items-center gap-3 rounded-card border border-warning/20 bg-warning-soft py-2 ps-3 pe-2 text-sm font-semibold text-warning-ink'
          }
        >
          <WarningIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">{r.text}</span>
        </div>
      ))}
      {props.approvals.length > 0 ? (
        <Button variant="secondary" size="md" icon={<KeyIcon size={20} />} onClick={props.onApprove}>
          رمز المدير
        </Button>
      ) : null}
    </div>
  );
}
