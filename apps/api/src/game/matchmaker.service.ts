import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BOT_USER_ID } from '@arena/shared';
import type { QueueMode } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { QueueService } from './queue.service';
import { MatchCreationService } from './match-creation.service';

const TICK_MS = 500;

/** Per-user random offset within [bots.queue_min_wait_s, bots.queue_max_wait_s].
 *  Stored in-memory so the same user gets a stable threshold across ticks. */
const botWaitThresholdMs = new Map<number, number>();

/**
 * Pairs players from Redis queues into matches. Runs as a setInterval inside the api process.
 *
 * Per ТЗ §8:
 *   - For each queue, take 2 oldest, ZREM, create match.
 *   - FREE: if user is alone in queue for >= 30s and Setting.bot_in_free=true → bot match.
 *   - 10s long-wait notification handled client-side from queue:status WS message.
 */
@Injectable()
export class MatchmakerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Matchmaker');
  private timer: NodeJS.Timeout | null = null;
  /** Guard against overlapping ticks (async tick takes longer than TICK_MS). */
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly creator: MatchCreationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.ticking) return; // skip if previous tick still running
      this.ticking = true;
      this.tick()
        .catch((e) => this.log.error(`tick failed: ${(e as Error).message}`))
        .finally(() => { this.ticking = false; });
    }, TICK_MS);
    this.log.log(`matchmaker tick=${TICK_MS}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async getBotInFreeEnabled(): Promise<boolean> {
    // Combined check: legacy 'gameplay.bot_in_free' AND new 'bots.enabled'.
    const [legacy, enabled] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: 'gameplay.bot_in_free' } }),
      this.prisma.setting.findUnique({ where: { key: 'bots.enabled' } }),
    ]);
    const legacyOn = legacy ? legacy.value === true || legacy.value === 'true' : true;
    const newOn = enabled ? enabled.value === true || enabled.value === 'true' : true;
    return legacyOn && newOn;
  }

  private async getBotWaitThresholdMs(userId: number): Promise<number> {
    const cached = botWaitThresholdMs.get(userId);
    if (cached !== undefined) return cached;
    const [minS, maxS] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: 'bots.queue_min_wait_s' } }),
      this.prisma.setting.findUnique({ where: { key: 'bots.queue_max_wait_s' } }),
    ]);
    const minMs = readPositiveNumber(minS?.value, 30) * 1000;
    const maxMs = readPositiveNumber(maxS?.value, 40) * 1000;
    const lo = Math.min(minMs, maxMs);
    const hi = Math.max(minMs, maxMs);
    const v = lo + Math.random() * Math.max(0, hi - lo);
    botWaitThresholdMs.set(userId, v);
    // Auto-evict after 5 min so memory doesn't grow.
    setTimeout(() => botWaitThresholdMs.delete(userId), 5 * 60_000).unref?.();
    return v;
  }

  async tick(): Promise<void> {
    const keys = await this.queue.listKeys();
    for (const key of keys) {
      await this.processQueue(key);
    }
  }

  private resolveQueueKeyToRoomId(key: string): { mode: 'FREE' | 'CASUAL' | 'STAKE'; roomId?: number } {
    if (key === 'mm:free') return { mode: 'FREE' };
    if (key === 'mm:casual') return { mode: 'CASUAL' };
    const m = /^mm:room:(\d+)$/.exec(key);
    if (m) return { mode: 'STAKE', roomId: Number(m[1]) };
    throw new Error(`unknown queue key: ${key}`);
  }

  private async pickRoom(mode: 'FREE' | 'CASUAL' | 'STAKE', roomId?: number) {
    if (roomId) {
      return this.prisma.room.findUnique({ where: { id: roomId } });
    }
    return this.prisma.room.findFirst({
      where: { mode, isActive: true },
      orderBy: { id: 'asc' },
    });
  }

  private async processQueue(key: string): Promise<void> {
    const { mode, roomId } = this.resolveQueueKeyToRoomId(key);
    let waiters = await this.queue.snapshot(key, 100);

    // Drop anyone who hit Cancel between the queue snapshot and now. Without
    // this filter a user who joins+cancels in quick succession can still be
    // paired (their leave() removes them from the zset, but if processQueue
    // had already cached the snapshot it doesn't see the removal). The user
    // would be on /home while their unaware opponent was sent into a match
    // alone and forfeited on the no-show timer.
    if (waiters.length > 0) {
      const flags = await Promise.all(
        waiters.map((w) => this.queue.isCancelled(w.userId)),
      );
      waiters = waiters.filter((_, i) => !flags[i]);
    }

    // Pair off 2-by-2.
    while (waiters.length >= 2) {
      const a = waiters.shift();
      const b = waiters.shift();
      if (!a || !b) break;
      // Guard against self-match (e.g. two browser tabs with the same account).
      if (a.userId === b.userId) {
        // Put b back and move on – can't pair a player with themselves.
        waiters.unshift(b);
        break;
      }
      const room = await this.pickRoom(mode, roomId);
      if (!room) {
        this.log.warn(`no room for ${key}, skipping pair`);
        break;
      }
      await this.queue.removeUsers(key, a.userId, b.userId);
      try {
        await this.creator.createMatch({
          player1Id: a.userId,
          player2Id: b.userId,
          room,
        });
      } catch (e) {
        const msg = (e as Error).message ?? '';
        this.log.error(`pair create failed: ${msg}`);
        // Don't re-queue on balance errors — those players can't pay and would
        // loop forever. They'll get 'idle' from the lobby WS and the client
        // will redirect them home.
        if (!msg.includes('insufficient_balance')) {
          const qMode = mode.toLowerCase() as QueueMode;
          await this.queue.join(a.userId, qMode, roomId).catch(() => undefined);
          await this.queue.join(b.userId, qMode, roomId).catch(() => undefined);
        }
      }
    }

    // Bot match for FREE if remaining waiter is old enough.
    if (mode === 'FREE' && waiters.length === 1 && waiters[0]) {
      const enabled = await this.getBotInFreeEnabled();
      if (!enabled) return;
      const waited = Date.now() - waiters[0].score;
      const threshold = await this.getBotWaitThresholdMs(waiters[0].userId);
      if (waited >= threshold) {
        const room = await this.pickRoom('FREE');
        if (!room) return;
        const userId = waiters[0].userId;
        botWaitThresholdMs.delete(userId);
        await this.queue.removeUsers(key, userId);
        try {
          await this.creator.createMatch({
            player1Id: userId,
            player2Id: BOT_USER_ID,
            room,
            isBotMatch: true,
          });
        } catch (e) {
          this.log.error(`bot match failed: ${(e as Error).message}`);
        }
      }
    }
  }
}

function readPositiveNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}
