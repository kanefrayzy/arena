import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param,
  ParseIntPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../common/prisma/prisma.module';

type UploadedMulterFile = { buffer: Buffer; mimetype: string; originalname: string; size: number };

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 1024 * 1024;

const decRe = /^\d+(\.\d{1,8})?$/;
const createSchema = z.object({
  slug: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1).max(100),
  kind: z.enum(['betra_card', 'betra_payout', 'westwallet']),
  currency: z.string().min(1).max(20),
  iconUrl: z.string().max(500).nullable().optional(),
  minAmount: z.string().regex(decRe).nullable().optional(),
  maxAmount: z.string().regex(decRe).nullable().optional(),
  usdRate: z.string().regex(decRe).nullable().optional(),
  isDeposit: z.boolean().optional(),
  isWithdraw: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  payoutMode: z.enum(['manual', 'semi_auto', 'instant']).optional(),
});
type CreateInput = z.infer<typeof createSchema>;

const patchSchema = createSchema.partial().omit({ slug: true });
type PatchInput = z.infer<typeof patchSchema>;

function ensureDir(): string {
  const dir = join(process.cwd(), 'uploads', 'payment-icons');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function extFromMime(m: string): string {
  if (m === 'image/png') return '.png';
  if (m === 'image/jpeg') return '.jpg';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/svg+xml') return '.svg';
  return '.bin';
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/payment-methods')
export class PaymentMethodsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const items = await this.prisma.paymentMethod.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return {
      items: items.map((m) => ({
        id: m.id, slug: m.slug, label: m.label, kind: m.kind, currency: m.currency,
        iconUrl: m.iconUrl,
        minAmount: m.minAmount?.toString() ?? null,
        maxAmount: m.maxAmount?.toString() ?? null,
        usdRate: m.usdRate?.toString() ?? null,
        isDeposit: m.isDeposit, isWithdraw: m.isWithdraw, isActive: m.isActive,
        sortOrder: m.sortOrder, payoutMode: m.payoutMode,
      })),
    };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(createSchema)) body: CreateInput) {
    return this.prisma.paymentMethod.create({ data: body as any });
  }

  @Patch(':id')
  async patch(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(patchSchema)) body: PatchInput) {
    return this.prisma.paymentMethod.update({ where: { id }, data: body as any });
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.paymentMethod.delete({ where: { id } });
    return { ok: true };
  }

  @Post(':id/icon')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadIcon(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: UploadedMulterFile | undefined) {
    const m = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!m) throw new NotFoundException();
    if (!file) throw new BadRequestException('no file');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('unsupported mime');
    if (file.size > MAX_BYTES) throw new BadRequestException('file too large');

    const ext = extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
    const filename = `${m.slug}${ext}`;
    const fullPath = join(ensureDir(), filename);
    writeFileSync(fullPath, file.buffer);
    const iconUrl = `/uploads/payment-icons/${filename}?v=${Date.now()}`;
    await this.prisma.paymentMethod.update({ where: { id }, data: { iconUrl } });
    return { ok: true, iconUrl };
  }
}
