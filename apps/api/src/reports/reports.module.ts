import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AdminReportsController, MatchReportsController } from './reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MatchReportsController, AdminReportsController],
})
export class ReportsModule {}
