import { Injectable, Logger } from '@nestjs/common';
import type { QueueMode } from '@arena/shared';
import { RedisService } from '../common/redis/redis.module';

const queueKey = (mode: QueueMode, roomId?: number): string => {
  if (mode === 'free') return 'mm:free';
  if (mode === 'casual') return 'mm:casual';
  if (mode === 'stake' && roomId) return `mm:room:${roomId}`;
  throw new Error('invalid queue key');
};

const userKey = (userId: number) => `mm:user:${userId}`;

export interface UserQueueState {
  mode: QueueMode;
  roomId?: number;
  joinedAt: number;
}

/**
 * Redis-backed FIFO queue for matchmaking.
 *
 * Sorted sets keyed by mode/room hold userIds, scored by join timestamp.
 * mm:user:{id} hash records which queue a user is in (for cancel + dedupe).
 */
@Injectable()
export class QueueService {
  private readonly log = new Logger('Queue');
  constructor(private readonly redis: RedisService) {}

  async join(userId: number, mode: QueueMode, roomId?: number): Promise<UserQueueState> {
    // Prevent double-queueing
    await this.leave(userId);
    // Clear the recently-cancelled marker set by leave() above. Without this
    // the matchmaker would skip the user for up to 10 seconds on every
    // join-after-cancel, making a quick Cancel → Search retry feel like a
    // 10-second hang before the actual pairing happens.
    await this.redis.client.del(`mm:cancelled:${userId}`).catch(() => 0);

    const key = queueKey(mode, roomId);
    const now = Date.now();
    await this.redis.client
      .multi()
      .zadd(key, now, String(userId))
      .hset(userKey(userId), {
        mode,
        roomId: roomId ? String(roomId) : '',
        joinedAt: String(now),
        queueKey: key,
      })
      .expire(userKey(userId), 600)
      .exec();
    this.log.log(`user ${userId} joined ${key}`);
    const state: UserQueueState = { mode, joinedAt: now };
    if (roomId !== undefined) state.roomId = roomId;
    return state;
  }

  async leave(userId: number): Promise<boolean> {
    const data = await this.redis.client.hgetall(userKey(userId));
    // Set a short-lived "recently cancelled" marker even when the user wasn't
    // in the queue at exactly this instant — the matchmaker may have already
    // pulled them into a snapshot and be milliseconds away from creating a
    // match. processQueue() consults this key just before pairing, and
    // match-creation also consults it before publishing match:found, so a
    // user who clicked Cancel cannot end up forfeiting a match they didn't
    // know was being created.
    await this.redis.client.set(`mm:cancelled:${userId}`, '1', 'EX', 10);
    // Best-effort: also drop any pending-match key the matchmaker may have
    // racily set after leave() removed the user from the queue.
    await this.redis.client.del(`lobby:pending-match:${userId}`).catch(() => 0);
    if (!data || !data.queueKey) return false;
    await this.redis.client
      .multi()
      .zrem(data.queueKey, String(userId))
      .del(userKey(userId))
      .exec();
    this.log.log(`user ${userId} left ${data.queueKey}`);
    return true;
  }

  async getState(userId: number): Promise<UserQueueState | null> {
    const data = await this.redis.client.hgetall(userKey(userId));
    if (!data || !data.queueKey) return null;
    const state: UserQueueState = {
      mode: data.mode as QueueMode,
      joinedAt: Number(data.joinedAt ?? 0),
    };
    if (data.roomId) state.roomId = Number(data.roomId);
    return state;
  }

  /** Returns up to N oldest waiting users with their queueKey. */
  async snapshot(key: string, count = 100): Promise<{ userId: number; score: number }[]> {
    const arr = await this.redis.client.zrange(key, 0, count - 1, 'WITHSCORES');
    const out: { userId: number; score: number }[] = [];
    for (let i = 0; i < arr.length; i += 2) {
      out.push({ userId: Number(arr[i]), score: Number(arr[i + 1]) });
    }
    return out;
  }

  async listKeys(): Promise<string[]> {
    // Static keys (free/casual) + dynamic mm:room:*
    const dyn = await this.redis.client.keys('mm:room:*');
    return ['mm:free', 'mm:casual', ...dyn];
  }

  async removeUsers(key: string, ...userIds: number[]): Promise<void> {
    if (userIds.length === 0) return;
    const m = this.redis.client.multi();
    for (const uid of userIds) {
      m.zrem(key, String(uid));
      m.del(userKey(uid));
    }
    await m.exec();
  }

  /** True iff the user pressed Cancel within the last few seconds. The
   *  matchmaker uses this to skip pairing them when their leave() raced with
   *  the snapshot/createMatch path. */
  async isCancelled(userId: number): Promise<boolean> {
    const v = await this.redis.client.get(`mm:cancelled:${userId}`);
    return v === '1';
  }
}
