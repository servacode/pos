import { createHmac, randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env';
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

/**
 * Test mode of the local server (OTP_DELIVERY=screen, DEPLOYMENT=local only): there is no SMS
 * there, so the sign-up answer carries the code. Nothing is sent.
 */
export function screenOtpSender(): OtpSender {
  return {
    async send() {},
  };
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
