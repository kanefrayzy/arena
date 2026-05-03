import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../common/redis/redis.module';
import { WalletModule } from '../wallet/wallet.module';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { MatchTokenService } from './match-token.service';
import { MatchCreationService } from './match-creation.service';
import { MatchmakerService } from './matchmaker.service';
import { LobbyGateway } from './lobby.gateway';
import { MatchesController } from './matches.controller';
import { InternalMatchController } from './internal-match.controller';
import { HmacGuard } from './hmac.guard';

@Module({
  imports: [
    RedisModule,
    WalletModule,
    JwtModule.register({}), // secrets passed per-call
  ],
  providers: [
    QueueService,
    MatchTokenService,
    MatchCreationService,
    MatchmakerService,
    LobbyGateway,
    HmacGuard,
  ],
  controllers: [QueueController, MatchesController, InternalMatchController],
  exports: [LobbyGateway],
})
export class GameModule {}
