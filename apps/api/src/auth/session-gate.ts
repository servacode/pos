import type { Database } from '@serva/db';
import type { Clock } from '../clock';
import { isSessionLive } from '../services/sessions';
import type { AccessClaims } from './tokens';

const MAX_ENTRIES = 50_000;

/**
 * Decides whether an access token's session is still live (not signed out or revoked, user and
 * store active). Answers are cached for a short time, so a revocation on another server instance
 * takes effect within `cacheSeconds`; on this instance it takes effect at once through forget().
 */
export class SessionGate {
  private readonly cache = new Map<string, { live: boolean; until: number }>();

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly cacheSeconds: number,
  ) {}

  async isLive(claims: AccessClaims): Promise<boolean> {
    const now = this.clock.now();
    const cached = this.cache.get(claims.sessionId);
    if (cached && cached.until > now.getTime()) return cached.live;

    const live = await isSessionLive(this.db, claims, now);
    if (this.cacheSeconds > 0) {
      if (this.cache.size >= MAX_ENTRIES) this.prune(now.getTime());
      this.cache.set(claims.sessionId, { live, until: now.getTime() + this.cacheSeconds * 1000 });
    }
    return live;
  }

  /** Drops the cached answer for a session family, e.g. right after it is signed out. */
  forget(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.cache) if (entry.until <= now) this.cache.delete(key);
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
  }
}
