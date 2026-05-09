import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { PrismaService } from '../common/prisma/prisma.module';
import { AdminGuard } from './admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type UploadedMulterFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export const BRANDING_SLOTS = {
  favicon:  { label: 'Favicon',        w: 32,   h: 32,  hint: '32×32 PNG/ICO — иконка вкладки браузера' },
  logo:     { label: 'Логотип',         w: 400,  h: 120, hint: 'PNG/SVG — лого в шапке сайта (на тёмном фоне)' },
  icon192:  { label: 'PWA-иконка 192', w: 192,  h: 192, hint: '192×192 PNG — иконка приложения (PWA, Android)' },
  icon512:  { label: 'PWA-иконка 512', w: 512,  h: 512, hint: '512×512 PNG — иконка приложения (PWA, высокое DPI)' },
  og_image: { label: 'OG Image',       w: 1200, h: 630, hint: '1200×630 PNG/JPG — превью при репосте в соцсетях' },
} as const;

export type BrandingSlot = keyof typeof BRANDING_SLOTS;

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon',
]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function uploadDir(): string {
  const dir = join(process.cwd(), 'apps', 'api', 'uploads', 'branding');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function extFromMime(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/svg+xml') return '.svg';
  if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') return '.ico';
  return '.png';
}

@Controller('admin/branding')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BrandingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'branding.' } },
    });
    const map: Record<string, string | null> = {};
    for (const slot of Object.keys(BRANDING_SLOTS)) {
      map[slot] = null;
    }
    for (const row of rows) {
      const slot = row.key.replace('branding.', '');
      if (slot in BRANDING_SLOTS) map[slot] = typeof row.value === 'string' ? row.value : String(row.value);
    }
    return { slots: BRANDING_SLOTS, branding: map };
  }

  @Post(':slot')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(
    @Param('slot') slot: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body() _body: unknown,
  ) {
    if (!(slot in BRANDING_SLOTS)) throw new BadRequestException('unknown slot');
    if (!file) throw new BadRequestException('no file');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('unsupported mime type');
    if (file.size > MAX_BYTES) throw new BadRequestException('file too large (max 2 MB)');

    const ext = extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
    const filename = `${slot}${ext}`;
    writeFileSync(join(uploadDir(), filename), file.buffer);
    const url = `/uploads/branding/${filename}?v=${Date.now()}`;

    await this.prisma.setting.upsert({
      where: { key: `branding.${slot}` },
      update: { value: url },
      create: { key: `branding.${slot}`, value: url },
    });

    return { ok: true, slot, url };
  }
}

/** Public read-only endpoint — web app reads branding at boot */
@Controller('branding')
export class PublicBrandingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'branding.' } },
    });
    const map: Record<string, string> = {};
    for (const row of rows) {
      const slot = row.key.replace('branding.', '');
      if (typeof row.value === 'string') map[slot] = row.value;
    }
    return map;
  }
}
