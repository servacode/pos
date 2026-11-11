import { createHmac, randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env';
import { deriveKey } from './tokens';

export interface OtpMessage {
  phone: string;
  code: string;
  purpose: 'registration' | 'shop_order' | 'broadcast';
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

/** The placeholders an SMS request template may use */
export const SMS_PLACEHOLDERS = ['phone', 'digits', 'code', 'message'] as const;
const PLACEHOLDER = /\{(\w+)\}/g;

/** Names between braces in a template that are not an SMS placeholder (checked when the env loads) */
export function unknownPlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)]
    .map((m) => m[1]!)
    .filter((name) => !(SMS_PLACEHOLDERS as readonly string[]).includes(name));
}

export interface SmsGatewayConfig {
  url: string;
  method: 'POST' | 'PUT' | 'GET';
  /** "Name: value", e.g. "Authorization: Bearer …" or "X-Api-Key: …" */
  authHeader?: string | undefined;
  /** Request body template; empty for GET */
  body: string;
  contentType: string;
  /** Send broadcast texts too (each one is a paid SMS); default no */
  allowBroadcasts: boolean;
}

type Escape = (value: string) => string;
const jsonEscape: Escape = (value) => JSON.stringify(value).slice(1, -1);

/** Fills {phone} {digits} {code} {message}; every value is escaped for where it lands. */
export function fillTemplate(template: string, values: Record<string, string>, escape: Escape): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(values, name) ? escape(values[name]!) : whole,
  );
}

/**
 * OTP_DELIVERY=sms: a generic HTTP SMS gateway. The request is described by environment variables
 * (URL, method, auth header, content type, body template), so a provider is a configuration, not
 * code. Values are escaped for their place: JSON strings in a JSON body, percent-encoding in a form
 * body or the URL. A 2xx answer means accepted; anything else throws OtpDeliveryError and the
 * reason (status only, never the code or the phone) goes to the log.
 */
export function smsOtpSender(
  config: SmsGatewayConfig,
  log: FastifyBaseLogger,
  send: typeof fetch = fetch,
): OtpSender {
  const isJson = /json/i.test(config.contentType);
  const isForm = /x-www-form-urlencoded/i.test(config.contentType);
  const bodyEscape: Escape = isJson ? jsonEscape : isForm ? encodeURIComponent : (v) => v;
  return {
    async send({ phone, code, purpose, text }) {
      if (purpose === 'broadcast' && !config.allowBroadcasts) throw new OtpDeliveryError();
      const values = {
        phone,
        digits: phone.replace(/\D/g, ''),
        code,
        message: text ?? otpText(code, purpose),
      };
      const headers: Record<string, string> = {};
      if (config.authHeader) {
        const at = config.authHeader.indexOf(':');
        headers[config.authHeader.slice(0, at).trim()] = config.authHeader.slice(at + 1).trim();
      }
      const hasBody = config.method !== 'GET' && config.body !== '';
      if (hasBody) headers['content-type'] = config.contentType;
      let status: number;
      try {
        const res = await send(fillTemplate(config.url, values, encodeURIComponent), {
          method: config.method,
          headers,
          ...(hasBody ? { body: fillTemplate(config.body, values, bodyEscape) } : {}),
          signal: AbortSignal.timeout(OTP_GATEWAY_TIMEOUT_MS),
        });
        status = res.status;
      } catch (error) {
        log.warn({ err: (error as Error).name }, 'SMS gateway unreachable');
        throw new OtpDeliveryError();
      }
      if (status < 200 || status >= 300) {
        log.warn({ status }, 'SMS gateway refused the message');
        throw new OtpDeliveryError();
      }
    },
  };
}

/** Tries each channel in order; the first that accepts the message wins. */
export function fallbackOtpSender(
  channels: { name: string; sender: OtpSender }[],
  log: FastifyBaseLogger,
): OtpSender {
  return {
    async send(message) {
      for (const [index, { name, sender }] of channels.entries()) {
        try {
          return await sender.send(message);
        } catch (error) {
          if (!(error instanceof OtpDeliveryError)) throw error;
          if (index < channels.length - 1) log.warn({ channel: name }, 'OTP channel failed; trying the next');
        }
      }
      throw new OtpDeliveryError();
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
  const channel = (name: string): OtpSender | null => {
    if (name === 'gateway' && env.OTP_GATEWAY_URL && env.OTP_GATEWAY_TOKEN) {
      return gatewayOtpSender(env.OTP_GATEWAY_URL, env.OTP_GATEWAY_TOKEN, log);
    }
    if (name === 'sms' && env.SMS_GATEWAY_URL) {
      return smsOtpSender(
        {
          url: env.SMS_GATEWAY_URL,
          method: env.SMS_GATEWAY_METHOD,
          authHeader: env.SMS_GATEWAY_AUTH_HEADER,
          body: env.SMS_GATEWAY_BODY,
          contentType: env.SMS_GATEWAY_CONTENT_TYPE,
          allowBroadcasts: env.SMS_ALLOW_BROADCASTS,
        },
        log,
      );
    }
    return null;
  };
  const primary = channel(delivery);
  if (!primary) return null;
  const fallback = env.OTP_FALLBACK ? channel(env.OTP_FALLBACK) : null;
  return fallback
    ? fallbackOtpSender(
        [
          { name: delivery, sender: primary },
          { name: env.OTP_FALLBACK!, sender: fallback },
        ],
        log,
      )
    : primary;
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
