import { wasteReasonsOf, type InventoryResponse, type InventoryRow } from '@serva/core';
import {
  Alert,
  Button,
  Dialog,
  formatQuantity,
  SearchField,
  Select,
  TextField,
  type Digits,
} from '@serva/ui';
import { qtyOf } from './api';
import { SerialPick } from './SerialPick';
import type { InventoryWaste } from './useInventoryWaste';

/** The window of «سجّل هدراً»: pick the spoiled item, the quantity (and serials), the reason, then confirm. */
export function InventoryWasteDialog({
  w,
  stock,
  saving,
  digits,
  manyBranches,
  branchLabel,
}: {
  w: InventoryWaste;
  stock: InventoryResponse | null;
  saving: boolean;
  digits: Digits;
  manyBranches: boolean;
  branchLabel: (r: Pick<InventoryRow, 'branchId' | 'branchName' | 'branchKind'>) => string;
}) {
  const { wasteRow } = w;
  return (
    <Dialog
      open={w.wasteOpen}
      onOpenChange={(open) => !open && !saving && w.setWasteOpen(false)}
      size="md"
      title="سجّل هدراً"
      description="ما تلف يخرج من المخزون بكلفته، ويظهر في «تلف وفقد»."
    >
      <form
        aria-label="سجّل هدراً"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          w.askWaste();
        }}
      >
        <SearchField
          label="ابحث عن الصنف التالف"
          value={w.wasteQuery}
          onValueChange={(v) => {
            w.setWasteQuery(v);
            w.setWasteAsk(false);
            w.setWasteError(null);
          }}
        />
        <Select
          label="الصنف التالف"
          value={w.wasteKey}
          onChange={(e) => {
            w.setWasteSerials([]);
            w.setWasteKey(e.target.value);
            w.setWasteAsk(false);
            w.setWasteError(null);
          }}
        >
          <option value="">اختر الصنف</option>
          {w.wasteOptions.map((r) => (
            <option key={`${r.branchId}:${r.variantId}`} value={`${r.branchId}:${r.variantId}`}>
              {manyBranches ? `${r.name} · ${branchLabel(r)}` : r.name}
            </option>
          ))}
        </Select>
        <TextField
          label="كمية الهدر"
          inputMode="decimal"
          dir="ltr"
          value={w.wasteQty}
          hint={
            wasteRow && wasteRow.qty > 0
              ? `الموجود من «${wasteRow.name}»: ${formatQuantity(wasteRow.qty, digits)}`
              : undefined
          }
          onChange={(e) => {
            w.setWasteSerials([]);
            w.setWasteQty(e.target.value);
            w.setWasteAsk(false);
            w.setWasteError(null);
          }}
          inputClassName="num"
        />
        {wasteRow?.tracksSerial && qtyOf(w.wasteQty) && qtyOf(w.wasteQty)! > 0 ? (
          <SerialPick
            name={wasteRow.name}
            variantId={wasteRow.variantId}
            branchId={wasteRow.branchId}
            pieces={Math.ceil(qtyOf(w.wasteQty)! / 1000)}
            picked={w.wasteSerials}
            onChange={(list) => {
              w.setWasteSerials(list);
              w.setWasteAsk(false);
              w.setWasteError(null);
            }}
          />
        ) : null}
        <Select
          label="السبب"
          value={w.wasteWhy || wasteReasonsOf(stock?.wasteReasons)[0]!}
          onChange={(e) => w.setWasteWhy(e.target.value)}
        >
          {wasteReasonsOf(stock?.wasteReasons).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        {w.wasteError ? <Alert tone="error">{w.wasteError}</Alert> : null}
        {w.wasteAsk && wasteRow ? (
          <Alert tone="warning">
            <div className="flex flex-col gap-3">
              <span>
                سيخرج <bdi className="num font-semibold">{w.wasteQty}</bdi> من «{wasteRow.name}» من المخزون
                بكلفته. هذا لا يُسترجع من هنا.
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="danger" loading={saving} onClick={() => void w.saveWaste()}>
                  أكّد الهدر
                </Button>
                <Button size="sm" variant="ghost" onClick={() => w.setWasteAsk(false)}>
                  رجوع
                </Button>
              </div>
            </div>
          </Alert>
        ) : null}
        <div className="ix-foot">
          <Button type="button" variant="ghost" disabled={saving} onClick={() => w.setWasteOpen(false)}>
            إلغاء
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            سجّل الهدر
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
