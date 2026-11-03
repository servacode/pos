// The HTTP side of the WhatsApp code sender: what the Serva API calls (OTP_DELIVERY=gateway,
// apps/api/src/auth/otp.ts). No dependency here, so it is tested on its own (server.test.mjs);
// whatsapp.mjs does the sending.
//
//   POST /send   Authorization: Bearer <BOT_TOKEN>
//                {"phone":"+963933123456","code":"482913","purpose":"registration","text":"…"}
//                202 queued · 400 bad body · 401 wrong token · 429 too many for this number
//                503 WhatsApp not linked yet (scan the QR code first)
//   GET /health  {"linked": true|false, "queued": n}
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY = 4096;
/** Codes per phone number per hour: more looks like abuse, and gets the bot's number banned */
export const PER_PHONE_PER_HOUR = 5;
/** Pause between two messages: a burst is what WhatsApp bans first */
export const GAP_MS = 2500;

const sameSecret = (given, expected) => {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** +963933123456 → 963933123456@s.whatsapp.net; null when not an E.164 number */
export function jidOf(phone) {
  return typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone)
    ? `${phone.slice(1)}@s.whatsapp.net`
    : null;
}

/**
 * @param {{ token: string, sender: { linked(): boolean, send(jid: string, text: string): Promise<void> },
 *           now?: () => number, gapMs?: number, log?: (msg: string) => void }} options
 */
export function createBotServer({ token, sender, now = Date.now, gapMs = GAP_MS, log = console.log }) {
  if (!token || token.length < 16) throw new Error('BOT_TOKEN must be 16 characters at least');
  const recent = new Map(); // phone → send times within the hour
  const queue = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const { jid, text } = queue.shift();
      try {
        await sender.send(jid, text);
        log(`sent to ${jid.slice(0, 6)}…`);
      } catch (error) {
        log(`not sent to ${jid.slice(0, 6)}…: ${error.message}`);
      }
      if (queue.length > 0) await new Promise((r) => setTimeout(r, gapMs));
    }
    running = false;
  }

  const answer = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return answer(res, 200, { linked: sender.linked(), queued: queue.length });
    }
    if (req.method !== 'POST' || req.url !== '/send') return answer(res, 404, { error: 'not_found' });
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), token)) {
      return answer(res, 401, { error: 'unauthorized' });
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return answer(res, 400, { error: 'invalid_json' });
      }
      const jid = jidOf(body.phone);
      if (!jid || typeof body.text !== 'string' || body.text.length === 0 || body.text.length > 1000) {
        return answer(res, 400, { error: 'invalid_message' });
      }
      if (!sender.linked()) return answer(res, 503, { error: 'not_linked' });
      const hourAgo = now() - 3_600_000;
      const times = (recent.get(body.phone) ?? []).filter((t) => t > hourAgo);
      if (times.length >= PER_PHONE_PER_HOUR) return answer(res, 429, { error: 'too_many' });
      times.push(now());
      recent.set(body.phone, times);
      queue.push({ jid, text: body.text });
      answer(res, 202, { queued: true });
      void drain();
    });
  });
  return server;
}
