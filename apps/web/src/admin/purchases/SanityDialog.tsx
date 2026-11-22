import { Button, Dialog } from '@serva/ui';

/** «راجع الأرقام قبل التسجيل»: the plain-words doubts about a document's costs, asked about before it is saved */
export function SanityDialog({
  warnings,
  title = 'راجع الأرقام قبل التسجيل',
  description = 'هذه الفاتورة تبدو غير معتادة. إن كانت صحيحة سجّلها.',
  confirm = 'الأرقام صحيحة، سجّل',
  onConfirm,
  onClose,
}: {
  warnings: string[];
  title?: string;
  description?: string;
  confirm?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
    >
      <div className="flex flex-col gap-4">
        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-ink">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirm}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            أعد المراجعة
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
