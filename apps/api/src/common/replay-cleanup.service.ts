import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Periodically deletes replay files older than REPLAY_RETENTION_DAYS (default 30).
 *
 * Replays are written by the game container as <matchId>.bin.gz inside the
 * `replays` volume which is bind-mounted into both `game` and `api` containers.
 * Without retention, at ~1000 concurrent users and thousands of matches per day
 * the volume would grow unbounded.
 *
 * Runs once at startup (after a short delay) and then every hour.
 */
@Injectable()
export class ReplayCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReplayCleanupService.name);
  private readonly baseDir = process.env.REPLAY_LOCAL_PATH ?? '/var/data/replays';
  private readonly retentionMs =
    (Number(process.env.REPLAY_RETENTION_DAYS) || 30) * 24 * 60 * 60 * 1000;
  private readonly intervalMs = 60 * 60 * 1000; // 1 hour
  private timer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    // Defer first run by 30s to avoid contending with startup work.
    setTimeout(() => this.runSafe(), 30_000).unref();
    this.timer = setInterval(() => this.runSafe(), this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runSafe(): Promise<void> {
    try {
      await this.cleanup();
    } catch (e) {
      this.log.warn(`replay cleanup failed: ${(e as Error).message}`);
    }
  }

  private async cleanup(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.baseDir);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return; // dir not created yet
      throw e;
    }
    const cutoff = Date.now() - this.retentionMs;
    let deleted = 0;
    let kept = 0;
    for (const name of entries) {
      if (!name.endsWith('.bin.gz')) continue;
      const full = path.join(this.baseDir, name);
      try {
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        if (st.mtimeMs < cutoff) {
          await fs.unlink(full);
          deleted++;
        } else {
          kept++;
        }
      } catch {
        // file vanished between readdir and stat — fine, skip
      }
    }
    if (deleted > 0) {
      this.log.log(`replay cleanup: deleted ${deleted}, kept ${kept} (retention ${this.retentionMs / 86400000}d)`);
    }
  }
}
