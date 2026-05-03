import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/jwt.strategy';

/** Allow only role=ADMIN. Use AFTER JwtAuthGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (req.user?.role !== 'ADMIN') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'admin role required' });
    }
    return true;
  }
}
