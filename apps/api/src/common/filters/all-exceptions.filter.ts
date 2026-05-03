import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = {
      error: { code: 'INTERNAL', message: 'Internal server error' },
    };

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = {
        error: { code: 'VALIDATION', message: 'Validation failed', details: exception.flatten() },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();

      // Caller passed a string → use as message.
      // Caller passed an object → preserve `code`, `message`, `details` if present.
      let code = this.codeFromStatus(status);
      let message: string = exception.message;
      let details: unknown;

      if (typeof r === 'string') {
        message = r;
      } else if (r && typeof r === 'object') {
        const obj = r as { code?: string; message?: string | string[]; details?: unknown };
        if (typeof obj.code === 'string') code = obj.code;
        if (obj.message !== undefined) {
          message = Array.isArray(obj.message) ? obj.message.join('; ') : String(obj.message);
        }
        if (obj.details !== undefined) details = obj.details;
      }

      body = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
    } else if (exception instanceof Error) {
      this.logger.error(`${req.method} ${req.url} :: ${exception.message}`, exception.stack);
    }

    if (status >= 400 && status < 500) {
      this.logger.warn(`${req.method} ${req.url} → ${status} ${body.error.code}: ${body.error.message}`);
    }
    res.status(status).json(body);
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'UNPROCESSABLE';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'ERROR';
    }
  }
}
