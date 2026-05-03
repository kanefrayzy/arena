import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** Validates request body/query against a Zod schema. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const flat = result.error.flatten();
      const fieldMsgs = Object.entries(flat.fieldErrors)
        .map(([field, msgs]) => `${field}: ${(msgs ?? []).join(', ')}`)
        .filter((s) => s.length > 0);
      const summary =
        fieldMsgs.length > 0
          ? fieldMsgs.join('; ')
          : (flat.formErrors.join('; ') || 'Validation failed');
      throw new BadRequestException({
        code: 'VALIDATION',
        message: summary,
        details: flat,
      });
    }
    return result.data;
  }
}
