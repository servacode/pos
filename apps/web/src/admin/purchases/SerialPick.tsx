import { useEffect, useState } from 'react';
import { toLatinDigits } from '@serva/core';
import { Alert, Button, Checkbox, TextField } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { stockSerialsOf } from './api';

/** Numbers typed, pasted or scanned: split on spaces, commas and lines, upper-cased, each once */
export function splitSerials(text: string): string[] {
  const out: string[] = [];
  let word = '';
  const flush = () => {
    const w = toLatinDigits(word).toUpperCase();
    if (w && !out.includes(w)) out.push(w);
    word = '';
  };
  for (const ch of text) {
    if (ch === ' ' || ch === ',' || ch === ';' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '،')
      flush();
    else word += ch;
  }
  flush();
  return out;
}

/**
 * A count or a waste of a product that tracks serial numbers (round 60): which numbers left the shelf. One box per
 * number in stock in that branch; the person ticks as many as pieces are missing, so the serial list and the count
 * agree. `pieces` is the shortage in whole pieces. Round 62: a search box (the list is cut at 1000), a box to paste
 * or scan the numbers, a notice when the list is cut, and `optional` for a write-off page where the numbers may be
 * put right later.
 */
export function SerialPick({
  name,
  variantId,
  branchId,
  pieces,
  picked,
  onChange,
  optional = false,
}: {
  name: string;
  variantId: string;
  branchId: string;
  pieces: number;
  picked: readonly string[];
  onChange: (serials: string[]) => void;
  optional?: boolean;
}) {
  const [list, setList] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [paste, setPaste] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        stockSerialsOf(variantId, branchId, q)
          .then((r) => {
            if (!live) return;
            setList(r.items);
            setTruncated(r.truncated);
          })
          .catch((e: unknown) => live && setError(errorMessage(e)));
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [variantId, branchId, q]);
  const full = picked.length >= pieces;

  /** Pasted or scanned numbers join the picked ones, up to the pieces missing; the server checks each is in stock */
  function addTyped() {
    const typed = splitSerials(paste);
    if (typed.length === 0) return;
    const fresh = typed.filter((t) => !picked.includes(t));
    const room = Math.max(0, pieces - picked.length);
    const take = fresh.slice(0, room);
    const unknown = !truncated && !q && list ? take.filter((t) => !list.includes(t)) : [];
    const ok = take.filter((t) => !unknown.includes(t));
    onChange([...picked, ...ok]);
    setPaste('');
    setNote(
      unknown.length > 0
        ? `ليست في مخزون هذا الفرع: ${unknown.join('، ')}`
        : fresh.length > room
          ? `أُضيف ${ok.length} فقط: لا يلزم أكثر من ${pieces}.`
          : null,
    );
  }

  return (
    <fieldset className="ix-serials">
      <legend>
        {name}: اختر <bdi className="sx-n">{pieces}</bdi> رقماً تسلسلياً للقطع الناقصة (اخترت{' '}
        <bdi className="sx-n">{picked.length}</bdi>)
        {optional ? ' — يمكنك تركها وتصحيحها لاحقاً من صفحة الأرقام التسلسلية' : ''}
      </legend>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {list === null && !error ? <p className="sx-wait">…</p> : null}
      {picked.length > 0 ? (
        <div className="ix-serial-chosen" aria-label="الأرقام المختارة">
          {picked.map((serial) => (
            <button
              key={serial}
              type="button"
              className="ix-serial-chip"
              onClick={() => onChange(picked.filter((p) => p !== serial))}
              aria-label={`أزل ${serial}`}
            >
              <bdi dir="ltr">{serial}</bdi> ×
            </button>
          ))}
        </div>
      ) : null}
      <div className="ix-serial-tools">
        <TextField
          label="ابحث في الأرقام"
          dir="ltr"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputClassName="num"
        />
        <TextField
          label="الصق أو امسح الأرقام"
          dir="ltr"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTyped();
            }
          }}
          inputClassName="num"
          hint="رقم أو عدة أرقام، ثم Enter"
        />
        <Button type="button" variant="secondary" size="sm" onClick={addTyped} disabled={!paste.trim()}>
          أضفها
        </Button>
      </div>
      {note ? <Alert tone="warning">{note}</Alert> : null}
      {truncated ? (
        <p className="sx-wait" data-testid="serial-truncated">
          تُعرض أول 1000 رقم فقط. اكتب جزءاً من الرقم في خانة البحث لتجد الباقي.
        </p>
      ) : null}
      {list?.length === 0 ? (
        <p className="sx-wait">
          {q
            ? 'لا رقم مطابق.'
            : 'لا أرقام تسلسلية في مخزون هذا الفرع لهذا الصنف. أضفها من صفحة الأرقام التسلسلية.'}
        </p>
      ) : null}
      <div className="ix-serial-list">
        {(list ?? []).map((serial) => {
          const on = picked.includes(serial);
          return (
            <Checkbox
              key={serial}
              label={<bdi dir="ltr">{serial}</bdi>}
              checked={on}
              disabled={!on && full}
              onChange={() => onChange(on ? picked.filter((p) => p !== serial) : [...picked, serial])}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A count that finds MORE pieces of a tracked product (round 62): the new numbers are written here (typed, pasted or
 * scanned), one per extra piece, because the stock goes up and the serial list must too. A number marked lost that
 * is found again is accepted back by the server.
 */
export function SerialEntry({
  name,
  pieces,
  picked,
  onChange,
}: {
  name: string;
  pieces: number;
  picked: readonly string[];
  onChange: (serials: string[]) => void;
}) {
  const [text, setText] = useState('');
  function add() {
    const typed = splitSerials(text).filter((t) => !picked.includes(t));
    if (typed.length === 0) return;
    onChange([...picked, ...typed]);
    setText('');
  }
  return (
    <fieldset className="ix-serials">
      <legend>
        {name}: اكتب <bdi className="sx-n">{pieces}</bdi> رقماً تسلسلياً للقطع الزائدة (كتبت{' '}
        <bdi className="sx-n">{picked.length}</bdi>)
      </legend>
      {picked.length > 0 ? (
        <div className="ix-serial-chosen" aria-label="الأرقام المكتوبة">
          {picked.map((serial) => (
            <button
              key={serial}
              type="button"
              className="ix-serial-chip"
              onClick={() => onChange(picked.filter((p) => p !== serial))}
              aria-label={`أزل ${serial}`}
            >
              <bdi dir="ltr">{serial}</bdi> ×
            </button>
          ))}
        </div>
      ) : null}
      <div className="ix-serial-tools">
        <TextField
          label="اكتب أو الصق أو امسح الأرقام"
          dir="ltr"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          inputClassName="num"
          hint="رقم أو عدة أرقام، ثم Enter"
        />
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={!text.trim()}>
          أضفها
        </Button>
      </div>
    </fieldset>
  );
}
