import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { I18nController } from './i18n.controller';
import { I18nService } from './i18n.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [ContentController, I18nController],
  providers: [ContentService, I18nService],
  exports: [ContentService, I18nService],
})
export class ContentModule {}
