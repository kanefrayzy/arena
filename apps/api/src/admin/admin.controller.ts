import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import type { Request } from 'express';
import { z } from 'zod';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

type UploadedMulterFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const ALLOWED_MIME_CHAR_SPRITE = new Set([...ALLOWED_MIME, 'image/gif', 'video/webm']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
function extFromMime(m: string): string {
  if (m === 'image/png') return '.png';
  if (m === 'image/jpeg') return '.jpg';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/svg+xml') return '.svg';
  if (m === 'image/gif') return '.gif';
  if (m === 'video/webm') return '.webm';
  return '.bin';
}
function ensureDir(sub: string): string {
  const dir = join(process.cwd(), 'uploads', sub);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const adjustBalanceSchema = z.object({
  amountUsd: z.string().regex(/^-?\d+(\.\d{1,8})?$/),
  reason: z.string().min(1).max(500),
});
type AdjustInput = z.infer<typeof adjustBalanceSchema>;

const banSchema = z.object({ reason: z.string().max(500).optional() });

const obstacleSchema = z.object({
  x: z.number().int().min(0).max(2000),
  y: z.number().int().min(0).max(2000),
  w: z.number().int().min(8).max(2000),
  h: z.number().int().min(8).max(2000),
  kind: z.enum(['crate', 'barrel', 'wall']).optional(),
});

const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  mode: z.enum(['FREE', 'CASUAL', 'STAKE']),
  stakeUsd: z.string().regex(/^\d+(\.\d{1,8})?$/).nullable().optional(),
  commissionPct: z.number().int().min(0).max(50).optional(),
  matchDurationS: z.number().int().min(30).max(600).optional(),
  winCondition: z.enum(['KILL', 'BEST_OF_3', 'TIMEOUT_HP']).optional(),
  minBalanceRequired: z.boolean().optional(),
  obstacles: z.array(obstacleSchema).max(32).optional(),
});
type RoomCreate = z.infer<typeof roomCreateSchema>;

const roomPatchSchema = roomCreateSchema.partial().extend({ isActive: z.boolean().optional() });
type RoomPatch = z.infer<typeof roomPatchSchema>;

const charCreateSchema = z.object({
  slug: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  baseHp: z.number().int().min(1).max(10000),
  baseSpeed: z.number().min(1).max(2000),
  baseDamage: z.number().int().min(0).max(10000),
  weaponType: z.string().min(1).max(50),
  abilityType: z.string().max(50).nullable().optional(),
  abilityCooldownS: z.number().int().min(0).max(120).optional(),
  spriteUrl: z.string().max(500).nullable().optional(),
  battleSpriteUrl: z.string().max(500).nullable().optional(),
  priceUsd: z.string().regex(/^\d+(\.\d{1,8})?$/).nullable().optional(),
  isStarter: z.boolean().optional(),
});
type CharCreate = z.infer<typeof charCreateSchema>;

const charPatchSchema = charCreateSchema.partial().extend({ isActive: z.boolean().optional() }).omit({ slug: true });
type CharPatch = z.infer<typeof charPatchSchema>;

const weaponCreateSchema = z.object({
  slug: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  spriteUrl: z.string().max(500).nullable().optional(),
  damage: z.number().int().min(0).max(10000).optional(),
  fireRateMs: z.number().int().min(50).max(10000).optional(),
  bulletSpeed: z.number().min(50).max(5000).optional(),
  priceUsd: z.string().regex(/^\d+(\.\d{1,8})?$/).nullable().optional(),
  isStarter: z.boolean().optional(),
});
type WeaponCreate = z.infer<typeof weaponCreateSchema>;

const weaponPatchSchema = weaponCreateSchema.partial().extend({ isActive: z.boolean().optional() }).omit({ slug: true });
type WeaponPatch = z.infer<typeof weaponPatchSchema>;

const skinCreateSchema = z.object({
  characterId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  rarity: z.string().min(1).max(20),
  spriteSetUrl: z.string().min(1).max(500),
  tint: z.string().max(20).nullable().optional(),
  statModifiers: z.record(z.number()).nullable().optional(),
  priceUsd: z.string().regex(/^\d+(\.\d{1,8})?$/).nullable().optional(),
});
type SkinCreate = z.infer<typeof skinCreateSchema>;

const skinPatchSchema = skinCreateSchema.partial().extend({ isActive: z.boolean().optional() }).omit({ characterId: true });
type SkinPatch = z.infer<typeof skinPatchSchema>;

const forceFinishSchema = z.object({
  winnerId: z.number().int().positive().nullable(),
  reason: z.string().min(1).max(500),
});
type ForceFinish = z.infer<typeof forceFinishSchema>;

const rejectSchema = z.object({ reason: z.string().min(1).max(500) });

const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
});
type SettingInput = z.infer<typeof settingSchema>;

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private adminId(req: Request): number {
    return ((req as Request & { user?: JwtPayload }).user?.sub ?? 0) as number;
  }

  // Dashboard
  @Get('stats/dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  // Users
  @Get('users')
  listUsers(@Query('search') search?: string, @Query('limit') limit?: string) {
    return this.admin.listUsers({ search, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Post('users/:id/ban')
  ban(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(banSchema)) body: { reason?: string },
    @Req() req: Request,
  ) {
    return this.admin.banUser(id, this.adminId(req), body.reason);
  }

  @Post('users/:id/unban')
  unban(@Param('id', ParseIntPipe) id: number) {
    return this.admin.unbanUser(id);
  }

  @Post('users/:id/adjust-balance')
  adjust(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(adjustBalanceSchema)) body: AdjustInput,
    @Req() req: Request,
  ) {
    return this.admin.adjustBalance(id, this.adminId(req), body.amountUsd, body.reason);
  }

  // Rooms CRUD
  @Get('rooms')
  listRooms() {
    return this.admin.listRooms();
  }

  @Post('rooms')
  createRoom(@Body(new ZodValidationPipe(roomCreateSchema)) body: RoomCreate) {
    return this.admin.createRoom(body);
  }

  @Patch('rooms/:id')
  patchRoom(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(roomPatchSchema)) body: RoomPatch,
  ) {
    return this.admin.updateRoom(id, body);
  }

  @Delete('rooms/:id')
  deleteRoom(@Param('id', ParseIntPipe) id: number) {
    return this.admin.deleteRoom(id);
  }

  // Characters CRUD
  @Get('characters')
  listCharacters() {
    return this.admin.listCharacters();
  }

  @Post('characters')
  createCharacter(@Body(new ZodValidationPipe(charCreateSchema)) body: CharCreate) {
    return this.admin.createCharacter(body);
  }

  @Patch('characters/:id')
  patchCharacter(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(charPatchSchema)) body: CharPatch,
  ) {
    return this.admin.updateCharacter(id, body);
  }

  @Post('characters/:id/sprite')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadCharacterSprite(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ) {
    if (!file) throw new BadRequestException('no file');
    if (!ALLOWED_MIME_CHAR_SPRITE.has(file.mimetype)) throw new BadRequestException('unsupported mime');
    if (file.size > MAX_BYTES) throw new BadRequestException('file too large');
    const ext = extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
    const filename = `char_${id}${ext}`;
    writeFileSync(join(ensureDir('characters'), filename), file.buffer);
    const url = `/uploads/characters/${filename}?v=${Date.now()}`;
    await this.admin.updateCharacter(id, { spriteUrl: url });
    return { ok: true, url };
  }

  @Post('characters/:id/battle-sprite')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadCharacterBattleSprite(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ) {
    if (!file) throw new BadRequestException('no file');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('unsupported mime');
    if (file.size > MAX_BYTES) throw new BadRequestException('file too large');
    const ext = extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
    const filename = `char_${id}_battle${ext}`;
    writeFileSync(join(ensureDir('characters'), filename), file.buffer);
    const url = `/uploads/characters/${filename}?v=${Date.now()}`;
    await this.admin.updateCharacter(id, { battleSpriteUrl: url });
    return { ok: true, url };
  }

  // Weapons CRUD
  @Get('weapons')
  listWeapons() {
    return this.admin.listWeapons();
  }

  @Post('weapons')
  createWeapon(@Body(new ZodValidationPipe(weaponCreateSchema)) body: WeaponCreate) {
    return this.admin.createWeapon(body);
  }

  @Patch('weapons/:id')
  patchWeapon(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(weaponPatchSchema)) body: WeaponPatch,
  ) {
    return this.admin.updateWeapon(id, body);
  }

  @Delete('weapons/:id')
  deleteWeapon(@Param('id', ParseIntPipe) id: number) {
    return this.admin.deleteWeapon(id);
  }

  @Post('weapons/:id/sprite')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadWeaponSprite(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ) {
    if (!file) throw new BadRequestException('no file');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('unsupported mime');
    if (file.size > MAX_BYTES) throw new BadRequestException('file too large');
    const ext = extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
    const filename = `weapon_${id}${ext}`;
    writeFileSync(join(ensureDir('weapons'), filename), file.buffer);
    const url = `/uploads/weapons/${filename}?v=${Date.now()}`;
    await this.admin.updateWeapon(id, { spriteUrl: url });
    return { ok: true, url };
  }

  // Skins CRUD
  @Post('skins')
  createSkin(@Body(new ZodValidationPipe(skinCreateSchema)) body: SkinCreate) {
    return this.admin.createSkin(body);
  }

  @Patch('skins/:id')
  patchSkin(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(skinPatchSchema)) body: SkinPatch,
  ) {
    return this.admin.updateSkin(id, body);
  }

  // Matches
  @Get('matches')
  listMatches(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.admin.listMatches({ status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Post('matches/:id/force-finish')
  forceFinish(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(forceFinishSchema)) body: ForceFinish,
    @Req() req: Request,
  ) {
    return this.admin.forceFinishMatch(id, this.adminId(req), body.winnerId, body.reason);
  }

  @Post('matches/:id/refund')
  refund(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason: string },
    @Req() req: Request,
  ) {
    return this.admin.refundMatch(id, this.adminId(req), body.reason);
  }

  // Payments
  @Get('payments')
  listPayments(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listPayments({ status, type, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Post('payments/:id/approve')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.admin.approvePayment(id, this.adminId(req));
  }

  @Post('payments/:id/reject')
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason: string },
    @Req() req: Request,
  ) {
    return this.admin.rejectPayment(id, this.adminId(req), body.reason);
  }

  // Settings
  @Get('settings')
  listSettings() {
    return this.admin.listSettings();
  }

  @Post('settings')
  upsertSetting(@Body(new ZodValidationPipe(settingSchema)) body: SettingInput) {
    return this.admin.upsertSetting(body.key, body.value);
  }

  @Delete('settings/:key')
  deleteSetting(@Param('key') key: string) {
    return this.admin.deleteSetting(key);
  }
}
