import { Controller, Get } from '@nestjs/common';
import { I18nService } from './i18n.service';

/** Public endpoint: returns admin-managed locale resources for the web client. */
@Controller('i18n')
export class I18nController {
  constructor(private readonly svc: I18nService) {}

  @Get('locales')
  list() {
    return this.svc.list();
  }
}
