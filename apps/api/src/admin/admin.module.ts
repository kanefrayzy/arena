import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SpritesController, PublicSpritesController } from './sprites.controller';
import { BrandingController, PublicBrandingController } from './branding.controller';
import { AdminSeoController, PublicSeoController, PublicManifestController } from './seo.controller';
import { AdminI18nController } from './i18n.admin.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContentModule } from '../content/content.module';

@Module({
  imports: [WalletModule, NotificationsModule, ContentModule],
  controllers: [
    AdminController,
    SpritesController,
    PublicSpritesController,
    BrandingController,
    PublicBrandingController,
    AdminSeoController,
    PublicSeoController,
    PublicManifestController,
    AdminI18nController,
  ],
  providers: [AdminService],
})
export class AdminModule {}
