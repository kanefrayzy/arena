import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded, static as expressStatic } from 'express';
import type { Request } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LobbyGateway } from './game/lobby.gateway';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser(process.env.CSRF_SECRET ?? 'dev-cookie-secret'));

  // Capture raw body on /internal/* for HMAC verification.
  app.use(
    json({
      verify: (req: Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
        if (req.url?.startsWith('/internal/')) {
          req.rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  // WestWallet IPN posts as application/x-www-form-urlencoded; capture raw too for any HMAC needs.
  app.use(
    urlencoded({
      extended: false,
      verify: (req: Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
        if (req.url?.startsWith('/internal/')) {
          req.rawBody = Buffer.from(buf);
        }
      },
    }),
  );

  app.setGlobalPrefix('api', {
    exclude: [
      'internal/(.*)',
      'uploads/(.*)',
      'manifest.webmanifest',
      'robots.txt',
      'sitemap.xml',
    ],
  });
  // Note: Zod-based validation is applied per-route via ZodValidationPipe.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Static serve uploaded sprites at /uploads/...
  const uploadsRoot = join(process.cwd(), 'apps', 'api', 'uploads');
  if (!existsSync(uploadsRoot)) mkdirSync(uploadsRoot, { recursive: true });
  app.use('/uploads', expressStatic(uploadsRoot, { maxAge: '7d', immutable: false }));

  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Wire WS upgrade for /ws/lobby
  const lobby = app.get(LobbyGateway);
  const httpServer = app.getHttpServer();
  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (url.startsWith('/ws/lobby')) {
      lobby.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
