import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

interface AuthedRequest extends Request {
  user: { sub: number };
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query('limit') limit?: string) {
    const take = Math.min(100, Math.max(1, Number(limit ?? 30)));
    return this.svc.list(req.user.sub, take);
  }

  @Patch(':id/read')
  markRead(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.svc.markRead(req.user.sub, BigInt(id));
  }

  @Patch('read-all')
  markAllRead(@Req() req: AuthedRequest) {
    return this.svc.markAllRead(req.user.sub);
  }
}
