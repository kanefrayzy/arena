import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';

export type NotificationType = 'deposit' | 'withdrawal' | 'match_win' | 'match_loss' | 'system';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(opts: {
    userId: number;
    type: NotificationType;
    title: string;
    body: string;
    meta?: Record<string, unknown>;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        body: opts.body,
        meta: opts.meta ?? undefined,
      },
    });
  }

  async list(userId: number, limit = 30) {
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        read: true,
        createdAt: true,
      },
    });
    const unreadCount = await this.prisma.notification.count({ where: { userId, read: false } });
    return { items: items.map((n) => ({ ...n, id: String(n.id) })), unreadCount };
  }

  async markRead(userId: number, id: bigint) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: number) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}
