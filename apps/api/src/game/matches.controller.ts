import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
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
      where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        player1: { select: { id: true, username: true } },
        player2: { select: { id: true, username: true } },
        room:    { select: { mode: true } },
      },
    });
    return { items };
  }

  @Get(':id')
  async one(@Req() req: AuthedRequest, @Param('id') id: string) {
    const m = await this.prisma.match.findUnique({ where: { id } });
    if (!m) throw new NotFoundException();
    const userId = req.user.sub;
    if (m.player1Id !== userId && m.player2Id !== userId) {
      throw new NotFoundException();
    }
    return m;
  }
}
