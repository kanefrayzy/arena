import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface MatchTokenPayload {
  matchId: string;
  userId: number;
}

/**
 * Issues short-lived JWTs (TTL 30s) signed with INTERNAL_SECRET that game-server
 * validates on /ws/match upgrade.
 */
@Injectable()
export class MatchTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: MatchTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: process.env.INTERNAL_SECRET ?? 'dev-internal',
      expiresIn: '30s',
    });
  }
}
