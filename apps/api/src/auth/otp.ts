import { createHmac, randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env';
import { deriveKey } from './tokens';

export interface OtpMessage {
  phone: string;
  code: string;
  purpose: 'registration' | 'password_reset' | 'shop_order' | 'broadcast';
  /** A message to customers (purpose broadcast) carries its own text and no code */
  text?: string;
}

/**
 * Delivers one-time codes. Development logs the code; the local server's test mode shows it on
 * screen; OTP_DELIVERY=gateway hands it to a sending service (WhatsApp for now, the owner's
 * decision of 3 Nov 2026; SMS later). With no sender, sign-up answers 503 instead of pretending
 * to send.
 */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}

/** Development only (refused in production by the environment check). */
export function logOtpSender(log: FastifyBaseLogger): OtpSender {
  return {
    async send({ phone, code, purpose }) {
      log.info(`[development] ${purpose} code for ${phone}: ${code}`);
    },
  };
}

/**
 * Test mode of the local server (OTP_DELIVERY=screen, DEPLOYMENT=local only): there is no SMS
 * there, so the sign-up answer carries the code. Nothing is sent.
 */
export function screenOtpSender(): OtpSender {
  return {
    async send() {},
  };
}

/** How long the gateway may take before sign-up answers «try again» */
export const OTP_GATEWAY_TIMEOUT_MS = 10_000;

/** The message the phone receives; the gateway may send its own wording from `code`. */
export const otpText = (code: string, purpose: OtpMessage['purpose'] = 'registration') =>
  purpose === 'shop_order'
    ? `رمز تأكيد طلبك من المتجر: ${code}\nصالح 10 دقائق.`
    : purpose === 'password_reset'
      ? `رمز تغيير كلمة السر في سيرفا: ${code}\nإن لم تطلبه فتجاهل الرسالة. صالح 10 دقائق.`
      : `رمز التحقق في سيرفا: ${code}\nلا تعطه لأحد. صالح 10 دقائق.`;

/**
 * OTP_DELIVERY=gateway: hands the code to a separate sending service (a WhatsApp bot today, an SMS
 * provider later) over HTTP, so changing the channel never touches this server. The gateway gets
 * POST {phone (E.164), code, purpose, text} with Authorization: Bearer OTP_GATEWAY_TOKEN and must
 * answer 2xx once it has accepted the message. Anything else throws, and sign-up answers 503
 * without saying why to the caller (the reason goes to the log, never the code).
 */
export function gatewayOtpSender(
  url: string,
  token: string,
  log: FastifyBaseLogger,
  send: typeof fetch = fetch,
): OtpSender {
  return {
    async send({ phone, code, purpose, text }) {
      let status: number;
      try {
        const res = await send(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ phone, code, purpose, text: text ?? otpText(code, purpose) }),
          signal: AbortSignal.timeout(OTP_GATEWAY_TIMEOUT_MS),
        });
        status = res.status;
      } catch (error) {
        log.warn({ err: (error as Error).name }, 'OTP gateway unreachable');
        throw new OtpDeliveryError();
      }
      if (status < 200 || status >= 300) {
        log.warn({ status }, 'OTP gateway refused the message');
        throw new OtpDeliveryError();
      }
    },
  };
}

/** The code could not be handed to its channel. */
export class OtpDeliveryError extends Error {
  constructor() {
    super('OTP delivery failed');
    this.name = 'OtpDeliveryError';
  }
}

/** True when sign-up codes are shown on screen (the local server's test mode). */
export function isTestMode(env: Env): boolean {
  return env.OTP_DELIVERY === 'screen' && env.DEPLOYMENT === 'local';
}

/** The sender OTP_DELIVERY asks for; null means sign-up answers 503. */
export function otpSenderFor(env: Env, log: FastifyBaseLogger): OtpSender | null {
  const delivery = env.OTP_DELIVERY ?? (env.NODE_ENV === 'production' ? 'none' : 'log');
  if (delivery === 'log') return logOtpSender(log);
  if (delivery === 'screen' && isTestMode(env)) return screenOtpSender();
  if (delivery === 'gateway' && env.OTP_GATEWAY_URL && env.OTP_GATEWAY_TOKEN) {
    return gatewayOtpSender(env.OTP_GATEWAY_URL, env.OTP_GATEWAY_TOKEN, log);
  }
  return null;
}

export function newOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC of the code bound to its challenge; the code itself is never stored. */
export function hashOtp(secret: string, challengeId: string, code: string): string {
  // The key is derived from JWT_SECRET; 'otp' is only the derivation label.
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
  const key = deriveKey(secret, 'otp').key;
  return createHmac('sha256', key).update(`${challengeId}:${code}`).digest('hex');
}
