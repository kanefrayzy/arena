import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { I18nService } from '../content/i18n.service';

const addLangSchema = z.object({
  code: z.string().min(2).max(8),
  name: z.string().min(1).max(64),
  flag: z.string().max(8).optional(),
});

const updateResourcesSchema = z.object({
  // Accept any JSON value at each leaf — the service flattens nested objects
  // and coerces primitives to strings, so a translator can paste either a
  // flat `{ "key": "value" }` dictionary or a nested namespaced JSON.
  resources: z.record(z.string(), z.unknown()),
});

@Controller('admin/i18n')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminI18nController {
  constructor(private readonly i18n: I18nService) {}

  /** Admin-only: list languages with stats. */
  @Get('languages')
  list() {
    return { items: this.i18n.listAdmin() };
  }

  /** Admin-only: full resource bundle for a single language (for the editor). */
  @Get('languages/:code')
  get(@Param('code') code: string) {
    return { resources: this.i18n.getResources(code) };
  }

  /** Admin-only: add a new language (auto-scaffolds keys from English). */
  @Post('languages')
  add(@Body(new ZodValidationPipe(addLangSchema)) body: z.infer<typeof addLangSchema>) {
    return { language: this.i18n.addLanguage(body) };
  }

  /** Admin-only: replace a language's resource bundle. */
  @Put('languages/:code')
  update(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateResourcesSchema)) body: z.infer<typeof updateResourcesSchema>,
  ) {
    this.i18n.updateResources(code, body.resources as Record<string, unknown>);
    return { ok: true };
  }

  @Delete('languages/:code')
  remove(@Param('code') code: string) {
    this.i18n.removeLanguage(code);
    return { ok: true };
  }
}
