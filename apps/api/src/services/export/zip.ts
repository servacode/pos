import { once } from 'node:events';
import { createDeflateRaw } from 'node:zlib';
import type { Writable } from 'node:stream';

/**
 * A ZIP archive written one entry at a time to a stream, without holding any entry in memory: each
 * entry is deflated as it is produced, its size and CRC-32 follow it in a data descriptor, and the
 * central directory at the end lists them. Names are UTF-8 (flag 11). It is the classic format, not
 * ZIP64, so a single archive stays under 4 GB and 65,535 entries; going over throws instead of
 * writing a file other programs cannot open.
 */

const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const FLAGS = 0x0808; // bit 3: sizes follow the data; bit 11: names are UTF-8
const MAX32 = 0xffff_ffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 continued over `chunk`; start from 0. */
export function crc32(chunk: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** DOS time and date of a moment (the format a ZIP stores), in UTC. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

interface Entry {
  name: Buffer;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private offset = 0;

  constructor(
    private readonly out: Writable,
    private readonly modifiedAt: Date,
  ) {}

  private async write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    if (this.offset > MAX32) throw new RangeError('الأرشيف أكبر من 4 غيغابايت');
    if (!this.out.write(chunk)) await once(this.out, 'drain');
  }

  /** Adds a file whose bytes come from `source`, deflated as they arrive. */
  async add(
    name: string,
    source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
  ): Promise<void> {
    if (this.entries.length >= 0xfffe) throw new RangeError('عدد الملفات في الأرشيف كبير جداً');
    const nameBytes = Buffer.from(name, 'utf8');
    const { time, date } = dosDateTime(this.modifiedAt);
    const entry: Entry = { name: nameBytes, crc: 0, compressed: 0, size: 0, offset: this.offset, time, date };

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt16LE(nameBytes.length, 26);
    await this.write(Buffer.concat([header, nameBytes]));

    const deflate = createDeflateRaw({ level: 6 });
    const finished = new Promise<void>((resolve, reject) => {
      deflate.on('end', resolve);
      deflate.on('error', reject);
    });
    let pending: Promise<void> = Promise.resolve();
    // The deflater's output goes to the stream in order; a full stream pauses it until it drains
    deflate.on('data', (piece: Buffer) => {
      entry.compressed += piece.length;
      deflate.pause();
      pending = pending.then(() => this.write(piece)).then(() => void deflate.resume());
      pending.catch((error: unknown) => deflate.destroy(error as Error));
    });
    for await (const part of source) {
      const bytes = typeof part === 'string' ? Buffer.from(part, 'utf8') : part;
      entry.crc = crc32(bytes, entry.crc);
      entry.size += bytes.length;
      if (!deflate.write(bytes)) await once(deflate, 'drain');
    }
    deflate.end();
    await finished;
    await pending;

    if (entry.size > MAX32 || entry.compressed > MAX32)
      throw new RangeError('ملف في الأرشيف أكبر من 4 غيغابايت');
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DESCRIPTOR, 0);
    descriptor.writeUInt32LE(entry.crc, 4);
    descriptor.writeUInt32LE(entry.compressed, 8);
    descriptor.writeUInt32LE(entry.size, 12);
    await this.write(descriptor);
    this.entries.push(entry);
  }

  /** Writes the central directory and ends the stream. */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(CENTRAL, 0);
      record.writeUInt16LE(20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(FLAGS, 8);
      record.writeUInt16LE(8, 10);
      record.writeUInt16LE(e.time, 12);
      record.writeUInt16LE(e.date, 14);
      record.writeUInt32LE(e.crc, 16);
      record.writeUInt32LE(e.compressed, 20);
      record.writeUInt32LE(e.size, 24);
      record.writeUInt16LE(e.name.length, 28);
      record.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([record, e.name]));
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    await new Promise<void>((resolve, reject) => {
      this.out.once('error', reject);
      this.out.end(resolve);
    });
  }
}
