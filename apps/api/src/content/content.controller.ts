import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContentService } from './content.service';

const loadoutSchema = z.object({
  characterId: z.number().int().positive().optional(),
  skinId: z.number().int().positive().optional(),
  weaponId: z.number().int().positive().nullable().optional(),
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

  @Get('shop/characters')
  async shopCharacters() {
    return { items: await this.content.listShopCharacters() };
  }

  @Get('weapons')
  async weapons() {
    return { weapons: await this.content.listWeapons() };
  }

  @Get('shop/weapons')
  async shopWeapons() {
    return { items: await this.content.listShopWeapons() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('inventory/me')
  async inventory(@Req() req: AuthedRequest) {
    const skins = await this.content.getInventory(req.user.sub);
    const extra = await this.content.getMyShopInventory(req.user.sub);
    return { ...skins, characters: extra.characters, weapons: extra.weapons };
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
    return this.content.setLoadoutPartial(req.user.sub, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shop/skins/:id/buy')
  @HttpCode(200)
  async buy(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.content.buySkin(req.user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shop/characters/:id/buy')
  @HttpCode(200)
  async buyCharacter(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.content.buyCharacter(req.user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shop/weapons/:id/buy')
  @HttpCode(200)
  async buyWeapon(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.content.buyWeapon(req.user.sub, id);
  }
}
