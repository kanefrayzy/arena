import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface MatchTokenPayload {
  matchId: string;
  userId: number;
}

/**
 * Issues short-lived JWTs signed with INTERNAL_SECRET that game-server
 * validates on /ws/match upgrade.
 *
 * TTL must cover the full match lifecycle, not just the initial connection:
 *   - Match duration (90 s) + reconnect grace window (15 s)
 *   - Slow client init (PIXI/audio load on weak mobile devices)
 *   - User briefly backgrounding the tab and returning
 * Production logs showed the previous 30-second TTL caused both players to
 * sometimes fail to join the same match (one connects, the other hits
 * "jwt expired" 401), leaving the first player alone on an empty map.
 */
@Injectable()
export class MatchTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: MatchTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: process.env.INTERNAL_SECRET ?? 'dev-internal',
      expiresIn: '5m',
    });
  }
}
