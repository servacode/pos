import { uuidv7 } from '@serva/sync';
import type { ShortageRequestInput } from '@serva/core/contracts/pharmacy';
import { APP_VERSION } from '../../offline/sync';
import type { PosServices } from '../services';

/**
 * «طلبو زبون وما كان موجود» (round 38): a customer asked for something the shelf lacked. The request is kept on
 * the device first, with its own id, and sent whenever there is a connection: a retry cannot write it twice
 * (the server keys it by that id), and a refused one (an item the server does not know) is dropped, not retried.
 */

const KEY = 'pending-shortages';

type Queued = Pick<ShortageRequestInput, 'id' | 'variantId' | 'name' | 'qty'>;

async function queue(pos: PosServices): Promise<Queued[]> {
  return (await pos.local.get<Queued[]>(KEY)) ?? [];
}

/** Keeps a request on the device and tries to send it now: `sent` when the server has it, else `queued` */
export async function askShortage(
  pos: PosServices,
  request: { variantId: string | null; name: string; qty: number },
): Promise<'sent' | 'queued'> {
  const entry: Queued = { id: uuidv7(), variantId: request.variantId, name: request.name, qty: request.qty };
  await pos.local.set(KEY, [...(await queue(pos)), entry]);
  const left = await flushShortages(pos);
  return left === 0 ? 'sent' : 'queued';
}

/** Sends what is waiting, in order; stops at the first one that cannot reach the server. Returns how many remain. */
export async function flushShortages(pos: PosServices): Promise<number> {
  const token = pos.device.token;
  let waiting = await queue(pos);
  if (waiting.length === 0) return 0;
  if (!token || !pos.online()) return waiting.length;
  const send = pos.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  for (const entry of [...waiting]) {
    let res: Response;
    try {
      res = await send('/v1/device/shortages', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Device ${token}`,
          'X-App-Version': APP_VERSION,
        },
        body: JSON.stringify(entry),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      break;
    }
    // 2xx: written (or already there). 4xx: the server will never take it. Anything else: try again later
    if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 402) break;
    waiting = waiting.filter((w) => w.id !== entry.id);
    await pos.local.set(KEY, waiting);
  }
  return waiting.length;
}
