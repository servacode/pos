import { decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import type { PlatformLoginStepName } from '@serva/core';
import type { TokenKeys } from './tokens';

const ISSUER = 'serva-pos';
const AUDIENCE = 'serva-platform';
const TICKET_TTL_SECONDS = 10 * 60;

export interface LoginTicket {
  platformUserId: string;
  step: PlatformLoginStepName;
  /** The authenticator code was already given in this sign-in */
  codePassed: boolean;
}

/**
 * Proof that the platform password was right while another step is left (code, new password,
 * enrolment). Signed in the platform realm like a session token but with no role claim, so the
 * platform guard never accepts it as a session; it opens only the login-step routes.
 */
export function signLoginTicket(ticket: LoginTicket, keys: TokenKeys, now: Date): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const { kid, key } = keys.signingKey('platform');
  return new SignJWT({ pur: 'platform-login', stp: ticket.step, cp: ticket.codePassed })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid })
    .setSubject(ticket.platformUserId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TICKET_TTL_SECONDS)
    .sign(key);
}

export async function verifyLoginTicket(
  token: string,
  keys: TokenKeys,
  now: Date,
): Promise<LoginTicket | null> {
  try {
    const { kid } = decodeProtectedHeader(token);
    const key = typeof kid === 'string' ? keys.verificationKey('platform', kid) : undefined;
    if (!key) return null;
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      currentDate: now,
    });
    const step = payload.stp;
    if (
      payload.pur !== 'platform-login' ||
      typeof payload.sub !== 'string' ||
      (step !== 'code' && step !== 'password' && step !== 'enrol')
    ) {
      return null;
    }
    return { platformUserId: payload.sub, step, codePassed: payload.cp === true };
  } catch {
    return null;
  }
}
