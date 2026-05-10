import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { BetraService } from './betra.service';
import { WestwalletService } from './westwallet.service';
import { ExchangeService } from '../common/exchange.service';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentMethodsAdminController } from './payment-methods-admin.controller';

@Module({
  imports: [WalletModule, NotificationsModule],
  providers: [PaymentsService, BetraService, WestwalletService, ExchangeService],
  controllers: [PaymentsController, PaymentWebhookController, PaymentMethodsAdminController],
  exports: [PaymentsService, ExchangeService],
})
export class PaymentsModule {}
