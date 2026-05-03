import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { encode as mpEncode } from '@msgpack/msgpack';

/**
 * Replay file format: gzipped sequence of msgpack frames.
 * Each frame: [kind:string, t:number, payload:any]
 *
 *   kind = 'meta'     — once at start: {matchId, players, mapW, mapH, tickRate, durationMs}
 *   kind = 'input'    — { playerId, seq, dx, dy, angle, fire, ability }
 *   kind = 'snapshot' — server snapshot delivered to clients (decimated)
 *   kind = 'end'      — final result
 */
export class ReplayWriter {
  private gz: zlib.Gzip;
  private file: fs.WriteStream;
  private snapshotCounter = 0;

  constructor(matchId: string) {
    const baseDir = process.env.REPLAY_LOCAL_PATH ?? '/var/data/replays';
    fs.mkdirSync(baseDir, { recursive: true });
    const filePath = path.join(baseDir, `${matchId}.bin.gz`);
    this.file = fs.createWriteStream(filePath);
    this.gz = zlib.createGzip();
    this.gz.pipe(this.file);
    this.path = filePath;
  }

  readonly path: string;

  private write(kind: string, t: number, payload: unknown): void {
    const buf = mpEncode([kind, t, payload]);
    // length-prefixed for easier parsing later (4-byte big-endian)
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(buf.length, 0);
    this.gz.write(lenBuf);
    this.gz.write(Buffer.from(buf));
  }

  meta(t: number, info: unknown): void {
    this.write('meta', t, info);
  }

  input(t: number, input: unknown): void {
    this.write('input', t, input);
  }

  /** Write every Nth snapshot to keep replays small. */
  snapshot(t: number, snap: unknown, decim = 3): void {
    if (this.snapshotCounter++ % decim !== 0) return;
    this.write('snapshot', t, snap);
  }

  end(t: number, result: unknown): Promise<void> {
    this.write('end', t, result);
    return new Promise((resolve) => {
      this.gz.end(() => {
        this.file.end(() => resolve());
      });
    });
  }
}
