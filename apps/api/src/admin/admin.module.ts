import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SpritesController, PublicSpritesController } from './sprites.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [AdminController, SpritesController, PublicSpritesController],
  providers: [AdminService],
})
export class AdminModule {}
