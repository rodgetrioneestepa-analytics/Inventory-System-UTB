import type { Store as RateLimitStore } from 'express-rate-limit';
import { Store, hash, now } from './db.js';

// The shared PostgreSQL counter survives function recycling and is visible to
// every API instance. Keys are hashed, rather than storing client IPs.
export class DatabaseRateLimitStore implements RateLimitStore {
  private windowMs = 15 * 60 * 1000;
  init(options: { windowMs: number }) {
    this.windowMs = options.windowMs;
  }
  async increment(key: string) {
    await this.db.run('DELETE FROM auth_rate_limits WHERE expires_at<?', now());
    const started = new Date(Math.floor(Date.now() / this.windowMs) * this.windowMs);
    const resetTime = new Date(started.getTime() + this.windowMs);
    const row = await this.db.get(
      `INSERT INTO auth_rate_limits (key,hits,expires_at) VALUES (?,1,?)
       ON CONFLICT(key) DO UPDATE SET hits=auth_rate_limits.hits+1 RETURNING hits`,
      hash(key + ':' + started.toISOString()),
      resetTime.toISOString(),
    );
    return { totalHits: Number(row!.hits), resetTime };
  }
  async decrement(_key: string) {}
  async resetKey(_key: string) {}
  constructor(private readonly db: Store) {}
}
