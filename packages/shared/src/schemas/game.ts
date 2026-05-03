import { z } from 'zod';

export const characterSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  weaponType: z.enum(['ranged', 'rocket', 'shotgun']),
  abilityType: z.enum(['dash', 'shield', 'rocket']),
  baseHp: z.number().int().positive(),
  baseSpeed: z.number().positive(),
  baseDamage: z.number().int().positive(),
  abilityCooldownS: z.number().positive(),
  isEnabled: z.boolean(),
});
export type Character = z.infer<typeof characterSchema>;

export const matchSummarySchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'RUNNING', 'FINISHED', 'DISPUTED', 'CANCELLED']),
  mode: z.enum(['FREE', 'CASUAL', 'STAKE']),
  roomId: z.number().int().positive(),
  player1Id: z.number().int().positive(),
  player2Id: z.number().int().positive(),
  winnerId: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  finishedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MatchSummary = z.infer<typeof matchSummarySchema>;
