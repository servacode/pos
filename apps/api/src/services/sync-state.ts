import { serverState, type Transaction } from '@serva/db';

export interface ServerStateRow {
  serverEpoch: number;
  /** Tombstones before this transaction id were dropped */
  tombstoneHorizon: bigint;
}

/** The server epoch and tombstone horizon, carried by every sync answer. */
export async function readServerState(tx: Transaction): Promise<ServerStateRow> {
  const [row] = await tx
    .select({ serverEpoch: serverState.serverEpoch, tombstoneHorizon: serverState.tombstoneHorizon })
    .from(serverState)
    .limit(1);
  if (!row) throw new Error('server_state has no row: run the migrations');
  return { serverEpoch: row.serverEpoch, tombstoneHorizon: BigInt(row.tombstoneHorizon) };
}
