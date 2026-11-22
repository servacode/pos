import type { Dispatch, SetStateAction } from 'react';
import {
  AlertCircleIcon,
  BarcodeIcon,
  Button,
  CheckCircleIcon,
  ListIcon,
  Select,
  TextField,
} from '@serva/ui';
import { Panel } from '../sales/ui';

type Branch = { id: string; name: string; kind: string };

/** The scan box and the progress bar of a shelf count («العدّ بالمسح», «تقدّم الجرد»). */
export function InventoryCounting({
  manyBranches,
  branchList,
  countBranch,
  onCountBranch,
  countedNumber,
  countedOfBranch,
  countTotal,
  counts,
  scan,
  onScan,
  scanned,
  scanError,
  onAddScan,
  reviewing,
  setReviewing,
  saving,
  serialsMissing,
  countProblems,
  onSave,
  onCancel,
}: {
  manyBranches: boolean;
  branchList: Branch[];
  countBranch: string;
  onCountBranch: (id: string) => void;
  /** How many counted numbers are typed (all branches' rows of the count) */
  countedNumber: number;
  /** How many of the branch's rows have a counted number */
  countedOfBranch: number;
  countTotal: number;
  counts: Record<string, string>;
  scan: string;
  onScan: (v: string) => void;
  scanned: { variantId: string; name: string } | null;
  scanError: string | null;
  onAddScan: () => void;
  reviewing: boolean;
  setReviewing: Dispatch<SetStateAction<boolean>>;
  saving: boolean;
  serialsMissing: boolean;
  countProblems: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <Panel title="العدّ بالمسح">
        <p className="sx-wait" style={{ marginBottom: 12 }}>
          امسح كل قطعة على الرف بقارئ الباركود فتُعدّ وحدها، أو اكتب ما عددته لكل صنف في الجدول. ما تتركه
          فارغاً لا يُغيَّر.
        </p>
        <form
          aria-label="العدّ بالمسح"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onAddScan();
          }}
        >
          {manyBranches ? (
            <Select
              label="الفرع الذي تعدّه"
              value={countBranch}
              disabled={countedNumber > 0}
              onChange={(e) => onCountBranch(e.target.value)}
              className="w-full sm:w-56"
              hint={countedNumber > 0 ? 'ألغِ الجرد لتغيير الفرع.' : undefined}
            >
              {branchList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.kind === 'van' ? `${b.name} (مندوب)` : b.name}
                </option>
              ))}
            </Select>
          ) : null}
          <TextField
            label="امسح الباركود"
            dir="ltr"
            autoFocus
            autoComplete="off"
            value={scan}
            onChange={(e) => onScan(e.target.value.slice(0, 40))}
            className="w-full sm:w-72"
            inputClassName="num"
            startAdornment={<BarcodeIcon className="ms-3" />}
          />
          {scanned ? (
            <p role="status" className="sx-st ok" style={{ fontSize: 14 }}>
              <CheckCircleIcon />
              {scanned.name}: <bdi className="num">{counts[scanned.variantId] ?? ''}</bdi>
            </p>
          ) : null}
          {scanError ? (
            <p className="sx-st fill danger" style={{ fontSize: 14 }}>
              <AlertCircleIcon />
              {scanError}
            </p>
          ) : null}
        </form>
      </Panel>
      <div className="ix-countbar" role="group" aria-label="تقدّم الجرد">
        <span className="p">
          عُدّ <bdi className="sx-n">{countedOfBranch}</bdi> من <bdi className="sx-n">{countTotal}</bdi> صنفاً
          {manyBranches ? ` في ${branchList.find((b) => b.id === countBranch)?.name ?? ''}` : ''}
        </span>
        {countedNumber === 0 ? (
          <span className="h">اعدّ صنفاً واحداً على الأقل ليُفتح «راجع الجرد».</span>
        ) : null}
        <span className="ix-acts">
          <Button variant="ghost" onClick={onCancel}>
            إلغاء
          </Button>
          {reviewing ? (
            <>
              <Button variant="secondary" onClick={() => setReviewing(false)}>
                ارجع للتعديل
              </Button>
              <Button icon={<ListIcon />} onClick={onSave} loading={saving} disabled={serialsMissing}>
                سجّل الجرد
              </Button>
            </>
          ) : (
            <Button
              icon={<ListIcon />}
              disabled={countedNumber === 0 || countProblems}
              onClick={() => setReviewing(true)}
            >
              راجع الجرد
            </Button>
          )}
        </span>
      </div>
    </>
  );
}
