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
      const message =
        typeof r === 'string'
          ? r
          : ((r as { message?: string | string[] }).message ?? exception.message);
      body = {
        error: {
          code: this.codeFromStatus(status),
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      };
    } else if (exception instanceof Error) {
      this.logger.error(`${req.method} ${req.url} :: ${exception.message}`, exception.stack);
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
