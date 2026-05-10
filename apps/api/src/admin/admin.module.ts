import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SpritesController, PublicSpritesController } from './sprites.controller';
import { BrandingController, PublicBrandingController } from './branding.controller';
import { AdminSeoController, PublicSeoController, PublicManifestController } from './seo.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [
    AdminController,
    SpritesController,
    PublicSpritesController,
    BrandingController,
    PublicBrandingController,
    AdminSeoController,
    PublicSeoController,
    PublicManifestController,
  ],
  providers: [AdminService],
})
export class AdminModule {}
