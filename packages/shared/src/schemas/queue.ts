import { z } from 'zod';

export const queueModeSchema = z.enum(['free', 'casual', 'stake']);
export type QueueMode = z.infer<typeof queueModeSchema>;

export const queueJoinSchema = z.object({
  mode: queueModeSchema,
  roomId: z.number().int().positive().optional(),
});
export type QueueJoinInput = z.infer<typeof queueJoinSchema>;

export interface QueueStatus {
  state: 'idle' | 'searching' | 'long_wait' | 'matched';
  mode?: QueueMode;
  roomId?: number;
  waitMs?: number;
}

export interface MatchFoundPayload {
  matchId: string;
  matchToken: string;
  gameWsUrl: string;
  opponent: { id: number; username: string };
  room: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
}
