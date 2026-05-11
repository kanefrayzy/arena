import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BOT_USER_ID } from '@arena/shared';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public profile of any user. Returned even for the bot account (the
   * client uses it when opening the profile via match-history rows where
   * the opponent might be a bot in disguise). Sensitive fields (email,
   * password hash, balance) are NEVER returned.
   */
  @Get(':id/profile')
  async profile(@Param('id') idParam: string) {
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) throw new NotFoundException();

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        country: true,
        createdAt: true,
        role: true,
      },
    });
    if (!user) throw new NotFoundException();

    const stats = await this.prisma.userStats.findUnique({ where: { userId: id } });
    return {
      id: user.id,
      username: user.username,
      country: user.country,
      createdAt: user.createdAt,
      role: user.role,
      isBot: user.id === BOT_USER_ID,
      cup: stats?.cup ?? 0,
      mmr: stats?.mmr ?? 1000,
      wins: stats?.wins ?? 0,
      losses: stats?.losses ?? 0,
      draws: stats?.draws ?? 0,
      matchesPlayed: stats?.matchesPlayed ?? 0,
    };
  }
}
