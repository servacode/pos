/**
 * `/rep`: the rep's phone (المندوبون والتوزيع, docs/specs/32-sales-reps.md §وضع المندوب). A device of
 * kind `rep_phone` is linked to its van and opens here (`/link?kind=rep_phone`); the linking steps,
 * the day sheet, the van sale, orders and collection arrive with the next packages.
 *
 * It imports nothing on purpose: sharing `hall/DeviceGate` with the kitchen and waiter screens moves
 * modules between chunks and puts the admin chunk (at its 60 kB budget) over the limit. The package
 * that wires the gate here must make room first.
 */
export function RepApp() {
  return (
    <>
      <title>وضع المندوب · SERFA</title>
      <main className="grid min-h-dvh place-items-center bg-canvas p-4 text-center">
        <div className="flex max-w-sm flex-col gap-2">
          <h1 className="text-xl font-bold text-ink">وضع المندوب — قريباً</h1>
          <p className="text-sm text-ink-muted">
            يظهر هنا يوم المندوب: خط السير والبيع من السيارة والطلبيات والتحصيل.
          </p>
        </div>
      </main>
    </>
  );
}
