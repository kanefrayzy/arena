import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { PrismaService } from '../common/prisma/prisma.module';
import { AdminGuard } from './admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Local typing — avoid relying on Express.Multer global namespace.
type UploadedMulterFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

/** Slot definitions — single source of truth for what sprites the game uses. */
export const SPRITE_SLOTS = {
  player_you: { label: 'Игрок (вы)', w: 128, h: 128, hint: 'Top-down персонаж лицом ВПРАВО, прозрачный фон' },
  player_opp: { label: 'Игрок (противник)', w: 128, h: 128, hint: 'То же, но в красных тонах' },
  weapon: { label: 'Оружие', w: 96, h: 32, hint: 'Ствол смотрит ВПРАВО, центр кадра = рукоять' },
  bullet: { label: 'Пуля', w: 16, h: 16, hint: 'Маленький снаряд' },
  crate: { label: 'Ящик', w: 80, h: 80, hint: 'Деревянный ящик top-down' },
  barrel: { label: 'Бочка', w: 80, h: 80, hint: 'Металлическая бочка top-down' },
  wall: { label: 'Стена', w: 80, h: 80, hint: 'Каменный/бетонный блок' },
  bg_tile: { label: 'Фон (плитка)', w: 80, h: 80, hint: 'Бесшовная плитка пола 80×80' },
  crosshair: { label: 'Прицел (курсор)', w: 32, h: 32, hint: 'PNG/WebP с прозрачным фоном, центр = точка прицела' },
} as const;

export type SpriteSlot = keyof typeof SPRITE_SLOTS;

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif', 'video/webm']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function uploadDir(): string {
  // Static-serve root is `${cwd}/apps/api/uploads`; keep writes in the same tree.
  const dir = join(process.cwd(), 'apps', 'api', 'uploads', 'sprites');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function extFromMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/svg+xml') return '.svg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/webm') return '.webm';
  return '.bin';
}

@Controller('admin/sprites')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SpritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.sprite.findMany();
    const map: Record<string, unknown> = {};
    for (const r of rows) {
      map[r.slot] = { url: r.url, width: r.width, height: r.height, mime: r.mime, updatedAt: r.updatedAt };
    }
    return { slots: SPRITE_SLOTS, sprites: map };
  }

  @Post(':slot')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(
    @Param('slot') slot: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body() body: { width?: string; height?: string },
  ) {
    if (!(slot in SPRITE_SLOTS)) throw new BadRequestException('unknown slot');
    if (!file) throw new BadRequestException('no file');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('unsupported mime');
    if (file.size > MAX_BYTES) throw new BadRequestException('file too large');

    const ext = extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
    const filename = `${slot}${ext}`;
    const fullPath = join(uploadDir(), filename);
    writeFileSync(fullPath, file.buffer);
    const url = `/uploads/sprites/${filename}?v=${Date.now()}`;
    const width = Number(body.width) || SPRITE_SLOTS[slot as SpriteSlot].w;
    const height = Number(body.height) || SPRITE_SLOTS[slot as SpriteSlot].h;
    await this.prisma.sprite.upsert({
      where: { slot },
      update: { url, width, height, mime: file.mimetype },
      create: { slot, url, width, height, mime: file.mimetype },
    });
    return { ok: true, slot, url, width, height };
  }

  @Delete(':slot')
  async remove(@Param('slot') slot: string) {
    const row = await this.prisma.sprite.findUnique({ where: { slot } });
    if (!row) return { ok: true };
    // Best-effort file deletion.
    try {
      const fname = row.url.split('?')[0]?.split('/').pop();
      if (fname) {
        const p = join(uploadDir(), fname);
        if (existsSync(p)) unlinkSync(p);
      }
    } catch {
      /* ignore */
    }
    await this.prisma.sprite.delete({ where: { slot } });
    return { ok: true };
  }
}

/** Public read-only endpoint used by the game client. */
@Controller('sprites')
export class PublicSpritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.sprite.findMany();
    const map: Record<string, { url: string; width: number; height: number }> = {};
    for (const r of rows) map[r.slot] = { url: r.url, width: r.width, height: r.height };
    return map;
  }
}
