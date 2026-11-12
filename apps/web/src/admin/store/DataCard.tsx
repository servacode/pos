import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, IconChip, PackageOpenIcon } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { downloadStoreExport } from '../import/api';
import { SETTINGS_SECTIONS } from './parts';

/** Saves a binary answer as a file through the browser's download. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * «بيانات المتجر»: bringing data in from a file, and taking all of it out (docs/specs/24-legal.md:
 * بياناتك ملكك). The export is the owner's; it is a plain GET, so it also works once the
 * subscription has lapsed and the rest of the app is read-only.
 */
export function DataCard() {
  const section = SETTINGS_SECTIONS.data;
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportAll = async () => {
    setBusy(true);
    setDone(false);
    setError(null);
    try {
      const { blob, fileName } = await downloadStoreExport();
      saveBlob(blob, fileName ?? 'serva-export.zip');
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id={section.id} className="scroll-mt-32">
      <section aria-labelledby={titleId} className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <IconChip>
            <PackageOpenIcon />
          </IconChip>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {section.title}
            </h2>
            <p className="text-sm text-ink-muted">{section.description}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-line pt-5">
          <h3 className="font-semibold text-ink">استيراد من Excel</h3>
          <p className="text-sm text-ink-muted">
            انقل منتجاتك وزبائنك وموردينك وكمياتك وأرصدتهم من ملف xlsx أو csv، بعد فحصه كاملاً.
          </p>
          <div>
            <Link
              to="/import"
              className="inline-flex items-center rounded-control border border-line-control px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-muted"
            >
              استيراد البيانات
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-line pt-5">
          <h3 className="font-semibold text-ink">تصدير كل بيانات المتجر</h3>
          <p className="text-sm text-ink-muted">
            ملف مضغوط فيه كل شيء: المنتجات والمخزون والزبائن والموردون والفواتير والمشتريات والمرتجعات
            والورديات والقيود والإعدادات، بصيغتي Excel وJSON. بياناتك ملكك وتأخذها متى شئت، حتى لو انتهى
            اشتراكك. قد يطول التحضير دقيقة لمتجر كبير.
          </p>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {done ? <Alert tone="success">نزل الملف. احفظه في مكان آمن.</Alert> : null}
          <div>
            <Button variant="secondary" loading={busy} onClick={() => void exportAll()}>
              نزّل كل بيانات المتجر
            </Button>
          </div>
        </div>
      </section>
    </Card>
  );
}
