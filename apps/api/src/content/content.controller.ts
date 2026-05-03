import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContentService } from './content.service';

const loadoutSchema = z.object({
  characterId: z.number().int().positive(),
  skinId: z.number().int().positive(),
});
type LoadoutInput = z.infer<typeof loadoutSchema>;

interface AuthedRequest extends Request {
  user: { sub: number };
}

@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  // Public: list of characters + skins (no auth needed; safe data).
  @Get('characters')
  async characters() {
    return { characters: await this.content.listCharacters() };
  }

  @Get('shop/skins')
  async shop() {
    return { items: await this.content.listShop() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('inventory/me')
  async inventory(@Req() req: AuthedRequest) {
    return this.content.getInventory(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('loadout/me')
  async loadout(@Req() req: AuthedRequest) {
    return this.content.getLoadout(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Put('loadout/me')
  async setLoadout(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(loadoutSchema)) body: LoadoutInput,
  ) {
    return this.content.setLoadout(req.user.sub, body.characterId, body.skinId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shop/skins/:id/buy')
  @HttpCode(200)
  async buy(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.content.buySkin(req.user.sub, id);
  }
}
