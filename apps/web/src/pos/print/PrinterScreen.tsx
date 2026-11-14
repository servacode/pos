import { useState } from 'react';
import { Alert, Button, InfoIcon, MonitorIcon, PrintIcon, SalesIcon, Switch } from '@serva/ui';
import { ChoiceGroup, FlowHeader, OptionTile } from '../FlowParts';
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

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <FlowHeader
        onBack={onBack}
        icon={<PrintIcon size={24} />}
        title="الطابعة"
        description="طريقة طباعة الإيصال على هذا الجهاز، وعرض الورق."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <section className="flex flex-col gap-6 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6">
          <ChoiceGroup label="طريقة الطباعة" className="grid gap-3 md:grid-cols-2">
            <OptionTile
              selected={setting.mode === 'browser'}
              onClick={() => onChange({ ...setting, mode: 'browser' })}
              icon={<MonitorIcon />}
              title="من المتصفح"
              description="أي طابعة، مع نافذة الطباعة"
            />
            <OptionTile
              selected={setting.mode === 'usb'}
              onClick={() => (setting.name ? onChange({ ...setting, mode: 'usb' }) : void connect())}
              disabled={!supported}
              icon={<PrintIcon />}
              title="طابعة حرارية USB مباشرة"
              description={
                supported ? (setting.name ?? 'دون نافذة، أسرع') : 'تحتاج متصفح كروم أو إيدج على هذا الجهاز'
              }
            />
          </ChoiceGroup>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {supported ? (
            <Button variant="secondary" className="self-start" onClick={() => void connect()}>
              {setting.name ? 'غيّر الطابعة' : 'اختر الطابعة'}
            </Button>
          ) : null}
          <ChoiceGroup label="عرض الورق" className="grid grid-cols-2 gap-3">
            {([80, 58] as const).map((w) => (
              <OptionTile
                key={w}
                selected={paper === w}
                onClick={() => onPaper(w)}
                icon={<SalesIcon />}
                title={`${w} مم`}
              />
            ))}
          </ChoiceGroup>
          {setting.mode === 'usb' ? (
            <div className="border-t border-line pt-4">
              <Switch
                label="افتح درج النقد بعد كل دفعة نقدية"
                description="لدرج موصول بمنفذ الطابعة."
                checked={setting.drawer}
                onCheckedChange={(drawer) => onChange({ ...setting, drawer })}
              />
            </div>
          ) : null}
        </section>
        <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e1">
          <p className="flex items-start gap-2.5 text-sm text-ink-muted">
            <InfoIcon size={20} className="shrink-0 text-ink-subtle" />
            اطبع إيصالاً لتتأكد من الطابعة والورق. يُطبع آخر إيصال إن وُجد.
          </p>
          <Button size="lg" fullWidth icon={<PrintIcon />} onClick={onTest}>
            اطبع إيصال تجربة
          </Button>
        </aside>
      </div>
    </div>
  );
}
