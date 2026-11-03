/**
 * A thermal printer on USB, through WebUSB (Chrome and Edge, on the till's own computer or
 * tablet): the cashier picks it once, the browser remembers the permission, and receipts print
 * straight away with no print dialog. Printers are USB class 7; the job goes to the first bulk OUT
 * endpoint, in chunks.
 */

interface UsbEndpoint {
  direction: 'in' | 'out';
  type: string;
  endpointNumber: number;
}
interface UsbDevice {
  productName?: string;
  opened: boolean;
  configuration: {
    interfaces: {
      interfaceNumber: number;
      alternate: { interfaceClass: number; endpoints: UsbEndpoint[] };
    }[];
  } | null;
  open(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<unknown>;
}
interface UsbApi {
  requestDevice(options: { filters: { classCode?: number }[] }): Promise<UsbDevice>;
  getDevices(): Promise<UsbDevice[]>;
}

const usb = (): UsbApi | null => (globalThis.navigator as unknown as { usb?: UsbApi }).usb ?? null;

export const usbSupported = () => usb() !== null;

async function prepare(device: UsbDevice): Promise<number> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  for (const iface of device.configuration?.interfaces ?? []) {
    const out = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
    if (out) {
      await device.claimInterface(iface.interfaceNumber).catch(() => undefined);
      return out.endpointNumber;
    }
  }
  throw new Error('no printer output on this device');
}

/** Asks the cashier to pick the printer (needs a click). */
export async function pickPrinter(): Promise<string | null> {
  const api = usb();
  if (!api) return null;
  const device = await api.requestDevice({ filters: [{ classCode: 7 }] });
  await prepare(device);
  return device.productName ?? 'طابعة USB';
}

/** Sends the job to the printer picked before; false when there is none or it failed. */
export async function sendToPrinter(parts: readonly Uint8Array[]): Promise<boolean> {
  const api = usb();
  if (!api) return false;
  const [device] = await api.getDevices();
  if (!device) return false;
  try {
    const endpoint = await prepare(device);
    for (const part of parts) {
      for (let i = 0; i < part.length; i += 16_384) {
        await device.transferOut(endpoint, part.subarray(i, i + 16_384) as unknown as BufferSource);
      }
    }
    return true;
  } catch {
    return false;
  }
}
