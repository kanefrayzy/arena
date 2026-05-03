import { z } from 'zod';

/** Decimal money amount as string, e.g. "1.23000000". Use Prisma.Decimal on server. */
export const moneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,8})?$/, 'invalid money format');

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
