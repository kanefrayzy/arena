/** Game-wide constants. Settings that may change at runtime live in DB Setting table. */

export const ROOM_MODES = ['FREE', 'CASUAL', 'STAKE'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

export const ROLES = ['PLAYER', 'ADMIN', 'MODERATOR'] as const;
export type Role = (typeof ROLES)[number];

export const LEDGER_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'MATCH_STAKE_LOCK',
  'MATCH_STAKE_UNLOCK',
  'MATCH_WIN',
  'MATCH_LOSS',
  'COMMISSION',
  'ADJUSTMENT',
  'BONUS',
  'SHOP_PURCHASE',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const MATCH_STATUSES = [
  'PENDING',
  'RUNNING',
  'FINISHED',
  'DISPUTED',
  'CANCELLED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const WIN_CONDITIONS = ['KILL', 'BEST_OF_3', 'TIMEOUT_HP'] as const;
export type WinCondition = (typeof WIN_CONDITIONS)[number];

/** Reserved system user ids — created in seed. */
export const SYSTEM_USER_ID = 1;
export const BOT_USER_ID = 2;

/** Currency: USD with Decimal(20,8). NEVER use float. */
export const MONEY_DECIMALS = 8;

export const QUEUE_TIMEOUT_FIRST_OFFER_MS = 10_000;
export const QUEUE_TIMEOUT_BOT_OFFER_MS = 30_000;

export const DEFAULT_TICK_RATE = 30;
export const AFK_TIMEOUT_MS = 10_000;
export const LAG_COMP_MAX_MS = 200;

/** Match arena dimensions in server units (≈ pixels). */
export const MAP_WIDTH = 720;
export const MAP_HEIGHT = 1280;
export const PLAYER_RADIUS = 22;
export const BULLET_RADIUS = 5;

/** Default match duration when no one dies (TIMEOUT_HP). */
export const DEFAULT_MATCH_DURATION_MS = 90_000;
