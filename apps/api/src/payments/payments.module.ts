import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { BetraService } from './betra.service';
import { WestwalletService } from './westwallet.service';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentMethodsAdminController } from './payment-methods-admin.controller';

@Module({
  imports: [WalletModule],
  providers: [PaymentsService, BetraService, WestwalletService],
  controllers: [PaymentsController, PaymentWebhookController, PaymentMethodsAdminController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
