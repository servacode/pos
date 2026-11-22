import { useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { StatusPill } from '../sales/ui';

/** Whole days from one ISO day to a later one */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Round 64: the due date where the owner looks every day. A late invoice is a red «متأخرة»; one falling due within a week says
 * in how many days; later ones are the plain date. A date that is not open any more (paid, or not owed) is a quiet date.
 */
export function DueMark({
  dueDate,
  today,
  open,
}: {
  dueDate: string | null | undefined;
  today: string;
  /** Whether the invoice is still owed (listed by the due read); false: the date is shown quietly */
  open: boolean;
}) {
  const digits = useDigits();
  if (!dueDate) return <span className="sx-sub">—</span>;
  const days = daysBetween(today, dueDate);
  const date = <span className="sx-mute">{dayText(dueDate, digits)}</span>;
  if (!open) return date;
  if (days < 0) {
    return (
      <span className="px-duemark">
        <StatusPill kind="danger">متأخرة</StatusPill>
        {date}
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="px-duemark">
        <StatusPill kind="warn">
          {days === 0 ? 'اليوم' : days === 1 ? 'غداً' : `خلال ${days} أيام`}
        </StatusPill>
        {date}
      </span>
    );
  }
  return date;
}
