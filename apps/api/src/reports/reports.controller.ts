import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../common/prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { JwtPayload } from '../auth/jwt.strategy';

const REPORT_CATEGORIES = ['cheating', 'bug', 'abuse', 'connection', 'other'] as const;
const REPORT_STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'] as const;

const createReportSchema = z.object({
  category: z.enum(REPORT_CATEGORIES),
  message: z.string().min(3).max(2000),
});
type CreateReport = z.infer<typeof createReportSchema>;

const reviewSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  adminNote: z.string().max(2000).optional(),
});
type ReviewReport = z.infer<typeof reviewSchema>;

const userId = (req: Request): number =>
  ((req as Request & { user?: JwtPayload }).user?.sub ?? 0) as number;

@Controller('matches/:matchId/report')
@UseGuards(JwtAuthGuard)
export class MatchReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(
    @Param('matchId') matchId: string,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReport,
    @Req() req: Request,
  ) {
    const reporterId = userId(req);
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException({ code: 'MATCH_NOT_FOUND', message: 'match not found' });
    if (match.player1Id !== reporterId && match.player2Id !== reporterId) {
      throw new BadRequestException({ code: 'NOT_PARTICIPANT', message: 'not a participant' });
    }
    // Rate-limit: max 1 report per (reporter, match).
    const existing = await this.prisma.matchReport.findFirst({
      where: { matchId, reporterId },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && Date.now() - existing.createdAt.getTime() < 60_000) {
      throw new BadRequestException({ code: 'TOO_FAST', message: 'please wait a minute' });
    }
    const created = await this.prisma.matchReport.create({
      data: {
        matchId,
        reporterId,
        category: body.category,
        message: body.message,
      },
    });
    return { id: created.id, status: created.status };
  }
}

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('status') status?: string, @Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number(limit ?? 50), 1), 200);
    const rows = await this.prisma.matchReport.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take,
    });
    const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
    const matchIds = [...new Set(rows.map((r) => r.matchId))];
    const [users, matches] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: reporterIds } },
        select: { id: true, username: true, email: true },
      }),
      this.prisma.match.findMany({
        where: { id: { in: matchIds } },
        select: {
          id: true,
          status: true,
          winnerId: true,
          player1Id: true,
          player2Id: true,
          roomId: true,
          finishedAt: true,
        },
      }),
    ]);
    const uMap = new Map(users.map((u) => [u.id, u]));
    const mMap = new Map(matches.map((m) => [m.id, m]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        matchId: r.matchId,
        reporter: uMap.get(r.reporterId) ?? { id: r.reporterId, username: 'unknown', email: '' },
        category: r.category,
        message: r.message,
        status: r.status,
        adminNote: r.adminNote,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        match: mMap.get(r.matchId) ?? null,
      })),
    };
  }

  @Get('pending-count')
  async pendingCount() {
    const count = await this.prisma.matchReport.count({ where: { status: 'pending' } });
    return { count };
  }

  @Post(':id/review')
  async review(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(reviewSchema)) body: ReviewReport,
    @Req() req: Request,
  ) {
    const adminId = userId(req);
    const updated = await this.prisma.matchReport.update({
      where: { id },
      data: {
        status: body.status,
        adminNote: body.adminNote ?? null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });
    return { id: updated.id, status: updated.status };
  }
}
