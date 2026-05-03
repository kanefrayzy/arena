import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('characters')
@UseGuards(JwtAuthGuard)
export class CharactersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const items = await this.prisma.character.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    return { items };
  }
}
