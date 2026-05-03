import { z } from 'zod';

export const emailSchema = z.string().email().max(255).toLowerCase().trim();

export const usernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, 'username: only letters, digits and underscore');

export const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(128);

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  acceptTos: z.literal(true, {
    errorMap: () => ({ message: 'Terms of Service must be accepted' }),
  }),
  acceptAge: z.literal(true, {
    errorMap: () => ({ message: 'Age confirmation (18+) is required' }),
  }),
  acceptSkillGame: z.literal(true, {
    errorMap: () => ({ message: 'Skill-game acknowledgement is required' }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const meSchema = z.object({
  id: z.number().int().positive(),
  email: z.string(),
  username: z.string(),
  role: z.enum(['PLAYER', 'ADMIN', 'MODERATOR']),
  createdAt: z.string(),
});
export type Me = z.infer<typeof meSchema>;
