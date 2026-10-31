import type { PullSetPage } from './protocol';

/**
 * The snapshot file (17 › GET /v1/sync/bootstrap): gzip NDJSON, one JSON object per line.
 *
 *   {"kind":"header","snapshotId":…,"contractVersion":1,"serverEpoch":…,"createdAt":…,"sets":[…]}
 *   {"kind":"row","set":"users","row":{…}}       a row, in pull order
 *   {"kind":"delete","set":"users","id":"…"}     a deletion, in pull order
 *   {"kind":"cursor","set":"users","cursor":"…"} the set is complete; pull from here
 *   {"kind":"end","rows":123}                    the file is complete
 *
 * The server writes it from the same set builders the pull uses, so applying the snapshot and
 * pulling from its cursors gives exactly what a full pull gives.
 */
export type SnapshotLine =
  | {
      kind: 'header';
      snapshotId: string;
      contractVersion: number;
      serverEpoch: number;
      createdAt: string;
      sets: string[];
    }
  | { kind: 'row'; set: string; row: PullSetPage['upserts'][number] }
  | { kind: 'delete'; set: string; id: string }
  | { kind: 'cursor'; set: string; cursor: string }
  | { kind: 'end'; rows: number };

export class SnapshotFormatError extends Error {
  override readonly name = 'SnapshotFormatError';
}

export interface ParsedSnapshot {
  snapshotId: string;
  serverEpoch: number;
  /** Final rows per set: later lines win, deletions remove */
  sets: Record<string, Array<PullSetPage['upserts'][number]>>;
  cursors: Record<string, string>;
}

/**
 * Reads the text of a snapshot (already gunzipped). Refuses a file without its header, its end
 * line, or a cursor for every set it announces: a cut file is never applied.
 */
export function parseSnapshot(text: string): ParsedSnapshot {
  let header: Extract<SnapshotLine, { kind: 'header' }> | null = null;
  let ended = false;
  let count = 0;
  const rows = new Map<string, Map<string, PullSetPage['upserts'][number]>>();
  const cursors: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    if (ended) throw new SnapshotFormatError('data after the end line');
    let line: SnapshotLine;
    try {
      line = JSON.parse(raw) as SnapshotLine;
    } catch {
      throw new SnapshotFormatError('a line is not JSON');
    }
    if (!header) {
      if (line.kind !== 'header') throw new SnapshotFormatError('missing header');
      header = line;
      for (const set of line.sets) rows.set(set, new Map());
      continue;
    }
    switch (line.kind) {
      case 'row':
      case 'delete': {
        const set = rows.get(line.set);
        if (!set) throw new SnapshotFormatError(`unknown set ${line.set}`);
        if (line.kind === 'row') {
          set.set(line.row.id, line.row);
          count += 1;
        } else {
          set.delete(line.id);
        }
        break;
      }
      case 'cursor':
        if (!rows.has(line.set)) throw new SnapshotFormatError(`unknown set ${line.set}`);
        cursors[line.set] = line.cursor;
        break;
      case 'end':
        if (line.rows !== count) throw new SnapshotFormatError('row count does not match');
        ended = true;
        break;
      default:
        throw new SnapshotFormatError('unknown line');
    }
  }
  if (!header || !ended) throw new SnapshotFormatError('the file is incomplete');
  for (const set of header.sets) {
    if (cursors[set] === undefined) throw new SnapshotFormatError(`no cursor for ${set}`);
  }
  return {
    snapshotId: header.snapshotId,
    serverEpoch: header.serverEpoch,
    sets: Object.fromEntries([...rows].map(([set, byId]) => [set, [...byId.values()]])),
    cursors,
  };
}
