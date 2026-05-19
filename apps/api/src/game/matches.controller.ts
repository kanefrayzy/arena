import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthedRequest extends Request {
  user: { sub: number };
}

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async myMatches(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(50, Math.max(1, Number(limit ?? 20)));
    const userId = req.user.sub;
    const items = await this.prisma.match.findMany({
      where: {
        OR: [{ player1Id: userId }, { player2Id: userId }],
        status: 'FINISHED',
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        player1: { select: { id: true, username: true } },
        player2: { select: { id: true, username: true } },
        room:    { select: { mode: true, name: true } },
      },
    });

    // Per-match net delta for this user: sum of all ledger entries
    // (LOCK + UNLOCK + WIN/LOSS) for refType=match, refId=match.id.
    // Lock+unlock cancel out, leaving only the WIN/LOSS amount — exactly
    // what the user gained or lost from this match.
    const matchIds = items.map((m) => m.id);
    const deltas = matchIds.length
      ? await this.prisma.ledger.groupBy({
          by: ['refId'],
          where: { userId, refType: 'match', refId: { in: matchIds } },
          _sum: { amount: true },
        })
      : [];
    const deltaByMatch = new Map<string, string>();
    for (const d of deltas) {
      if (d.refId) deltaByMatch.set(d.refId, (d._sum.amount ?? new Prisma.Decimal(0)).toString());
    }

    // For bot matches, override player2.username with the per-match bot name
    // stored in `meta.botUsername` so history shows the same realistic name
    // the user saw during the match (instead of the literal "Bot").
    const decorated = items.map((m) => {
      const meta = (m.meta ?? {}) as { bot?: boolean; botUsername?: string };
      const myDelta = deltaByMatch.get(m.id) ?? '0';
      const base = { ...m, myDelta };
      if (meta.bot && meta.botUsername && m.player2) {
        return { ...base, player2: { ...m.player2, username: meta.botUsername } };
      }
      return base;
    });
    return { items: decorated };
  }

  @Get(':id')
  async one(@Req() req: AuthedRequest, @Param('id') id: string) {
    const m = await this.prisma.match.findUnique({ where: { id } });
    if (!m) throw new NotFoundException();
    const userId = req.user.sub;
    if (m.player1Id !== userId && m.player2Id !== userId) {
      throw new NotFoundException();
    }
    const deltaRow = await this.prisma.ledger.aggregate({
      where: { userId, refType: 'match', refId: id },
      _sum: { amount: true },
    });
    const myDelta = (deltaRow._sum.amount ?? new Prisma.Decimal(0)).toString();
    return { ...m, myDelta };
  }
}
