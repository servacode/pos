import { createHmac, randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { deriveKey } from './tokens';

export interface OtpMessage {
  phone: string;
  code: string;
  purpose: 'registration';
}

/**
 * Delivers one-time codes. The channels from 04/22 (SMS, Telegram bot, in-app, WhatsApp only as a
 * fallback) are not connected yet: development logs the code, production has no sender until one
 * is configured, and sign-up then answers 503 instead of pretending to send.
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
