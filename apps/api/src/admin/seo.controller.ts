import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';

const SEO_KEYS = [
  'site_name', 'title', 'description', 'keywords',
  'og_image_url', 'twitter_handle', 'canonical_url', 'theme_color',
] as const;

const DEFAULTS: Record<string, string> = {
  site_name: 'Faoor',
  title: 'Faoor — Skill PvP 1 на 1 за реальные деньги',
  description: 'Skill-based PvP арена 1 на 1. Сражайся за реальные деньги, без RNG и удачи — только чистый скилл.',
  keywords: 'faoor, arena, pvp, 1v1, skill arena, real money, esports, online battle, браузерная игра, дуэль',
  og_image_url: 'https://faoor.com/icons/icon-512.png',
  twitter_handle: '@faoor',
  canonical_url: 'https://faoor.com',
  theme_color: '#1a1450',
};

async function loadSeo(prisma: PrismaService): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: 'seo.' } },
  });
  const out: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) {
    const k = r.key.replace('seo.', '');
    out[k] = typeof r.value === 'string' ? r.value : String(r.value ?? '');
  }
  return out;
}

async function loadBranding(prisma: PrismaService): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: 'branding.' } },
  });
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.replace('branding.', '');
    if (typeof r.value === 'string') out[k] = r.value;
  }
  return out;
}

/** Public SEO config — used by web client to inject <meta> tags at boot. */
@Controller('seo')
export class PublicSeoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const [seo, branding] = await Promise.all([
      loadSeo(this.prisma),
      loadBranding(this.prisma),
    ]);
    return { seo, branding };
  }
}

/** Dynamic PWA manifest — built from branding/seo so admin uploads apply. */
@Controller()
export class PublicManifestController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async manifest() {
    const [seo, branding] = await Promise.all([
      loadSeo(this.prisma),
      loadBranding(this.prisma),
    ]);
    const icon192 = stripQuery(branding.icon192) ?? '/icons/icon-192.png';
    const icon512 = stripQuery(branding.icon512) ?? '/icons/icon-512.png';
    const themeColor = seo.theme_color || '#1a1450';
    return {
      name: seo.site_name || 'Faoor',
      short_name: (seo.site_name || 'Faoor').slice(0, 12),
      description: seo.description,
      theme_color: themeColor,
      background_color: '#0b0d12',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      icons: [
        { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      categories: ['games', 'entertainment'],
    };
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  async robots(@Res({ passthrough: true }) _res: Response) {
    const seo = await loadSeo(this.prisma);
    const lines = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin',
      'Disallow: /uploads/branding/',
    ];
    if (seo.canonical_url) {
      lines.push(`Sitemap: ${seo.canonical_url.replace(/\/$/, '')}/sitemap.xml`);
    }
    return lines.join('\n') + '\n';
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  async sitemap() {
    const seo = await loadSeo(this.prisma);
    const base = (seo.canonical_url || '').replace(/\/$/, '');
    const paths = ['/', '/home', '/shop', '/loadout', '/wallet'];
    const urls = paths
      .map((p) => `  <url><loc>${base}${p}</loc></url>`)
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  }
}

function stripQuery(u: string | undefined): string | undefined {
  if (!u) return undefined;
  const i = u.indexOf('?');
  return i >= 0 ? u.slice(0, i) : u;
}

/** Admin SEO read endpoint (under /api/admin/seo). For writes admins use the
 *  generic /admin/settings endpoint with key=seo.* */
@Controller('admin/seo')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSeoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    return loadSeo(this.prisma);
  }

  @Get('keys')
  list() {
    return { keys: SEO_KEYS };
  }
}
