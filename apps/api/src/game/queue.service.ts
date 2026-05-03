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
}
