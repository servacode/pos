import { useState } from 'react';
import { Alert, BackIcon, Button, cn, PrintIcon } from '@serva/ui';
import type { PaperWidth } from '../receipt/Receipt';
import { pickPrinter, usbSupported } from './usb';

export interface PrinterSetting {
  mode: 'browser' | 'usb';
  name: string | null;
  /** Open the cash drawer after a cash receipt (a drawer on the printer's kick port) */
  drawer: boolean;
}

export const DEFAULT_PRINTER: PrinterSetting = { mode: 'browser', name: null, drawer: false };
export const PRINTER_KEY = 'printer';

/**
 * «الطابعة» (21 › الطباعة المباشرة): print through the browser's dialog (any printer, the
 * default), or straight to a USB thermal printer with no dialog, opening the cash drawer after a
 * cash sale if one is wired to it. The paper width applies to both.
 */
export function PrinterScreen({
  setting,
  paper,
  onChange,
  onPaper,
  onTest,
  onBack,
}: {
  setting: PrinterSetting;
  paper: PaperWidth;
  onChange: (next: PrinterSetting) => void;
  onPaper: (width: PaperWidth) => void;
  onTest: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const supported = usbSupported();

  async function connect() {
    setError(null);
    try {
      const name = await pickPrinter();
      if (name) onChange({ ...setting, mode: 'usb', name });
    } catch {
      setError('لم يُختر جهاز. وصّل الطابعة بالـ USB وشغّلها، ثم اضغط «اختر الطابعة» مرة أخرى.');
    }
  }

  const choice = (active: boolean) =>
    cn(
      'flex min-h-16 flex-col items-start justify-center rounded-control border-2 px-4 text-start',
      active ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink',
    );

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          ارجع للبيع
        </Button>
        <h1 className="text-3xl font-bold text-ink">الطابعة</h1>
      </div>
      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <div role="group" aria-label="طريقة الطباعة" className="grid gap-2 md:grid-cols-2">
          <button
            type="button"
            aria-pressed={setting.mode === 'browser'}
            onClick={() => onChange({ ...setting, mode: 'browser' })}
            className={choice(setting.mode === 'browser')}
          >
            <span className="font-bold">من المتصفح</span>
            <span className="text-xs text-ink-muted">أي طابعة، مع نافذة الطباعة</span>
          </button>
          <button
            type="button"
            aria-pressed={setting.mode === 'usb'}
            onClick={() => (setting.name ? onChange({ ...setting, mode: 'usb' }) : void connect())}
            disabled={!supported}
            className={choice(setting.mode === 'usb')}
          >
            <span className="font-bold">طابعة حرارية USB مباشرة</span>
            <span className="text-xs text-ink-muted">
              {supported ? (setting.name ?? 'دون نافذة، أسرع') : 'تحتاج متصفح كروم أو إيدج على هذا الجهاز'}
            </span>
          </button>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {supported ? (
          <Button variant="secondary" onClick={() => void connect()}>
            {setting.name ? 'غيّر الطابعة' : 'اختر الطابعة'}
          </Button>
        ) : null}
        <div role="group" aria-label="عرض الورق" className="flex gap-2">
          {([80, 58] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={paper === w}
              onClick={() => onPaper(w)}
              className={choice(paper === w)}
            >
              <span className="font-bold">{w} مم</span>
            </button>
          ))}
        </div>
        {setting.mode === 'usb' ? (
          <label className="flex items-center gap-2 text-ink">
            <input
              type="checkbox"
              checked={setting.drawer}
              onChange={(e) => onChange({ ...setting, drawer: e.target.checked })}
            />
            افتح درج النقد بعد كل دفعة نقدية
          </label>
        ) : null}
        <Button icon={<PrintIcon />} onClick={onTest}>
          اطبع إيصال تجربة
        </Button>
      </section>
    </div>
  );
}
