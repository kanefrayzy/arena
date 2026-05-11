/**
 * Cup-ranking tier helpers + the small "RankBadge" pill used in the home top
 * bar and the user profile page. Centralised here so the result page,
 * profile page, and home all agree on the tier table.
 */

export interface RankTier {
  name: string;
  min: number;
  emoji: string;
  /** Tailwind ring colour (ring-*). */
  ring: string;
  /** Tailwind gradient classes for the glow background. */
  glow: string;
  /** Tailwind text colour for the cup number. */
  text: string;
}

export const RANK_TIERS: RankTier[] = [
  { name: 'Bronze',   min: 0,    emoji: '🥉', ring: 'ring-amber-700/60',  glow: 'from-amber-700/30 to-amber-900/10',   text: 'text-amber-300' },
  { name: 'Silver',   min: 100,  emoji: '🥈', ring: 'ring-slate-300/60',  glow: 'from-slate-300/30 to-slate-500/10',   text: 'text-slate-200' },
  { name: 'Gold',     min: 300,  emoji: '🥇', ring: 'ring-yellow-400/70', glow: 'from-yellow-400/35 to-yellow-700/10', text: 'text-yellow-200' },
  { name: 'Platinum', min: 600,  emoji: '🛡️', ring: 'ring-cyan-300/60',   glow: 'from-cyan-300/30 to-cyan-600/10',     text: 'text-cyan-200' },
  { name: 'Diamond',  min: 1000, emoji: '💎', ring: 'ring-sky-300/70',    glow: 'from-sky-300/35 to-indigo-600/10',    text: 'text-sky-200' },
  { name: 'Master',   min: 1500, emoji: '👑', ring: 'ring-fuchsia-400/70', glow: 'from-fuchsia-400/40 to-purple-700/15', text: 'text-fuchsia-200' },
  { name: 'Legend',   min: 2500, emoji: '⚡', ring: 'ring-rose-400/80',   glow: 'from-rose-400/40 to-orange-500/15',   text: 'text-rose-200' },
];

export function tierFor(cup: number): { tier: RankTier; next: RankTier | null } {
  let tier = RANK_TIERS[0]!;
  let next: RankTier | null = RANK_TIERS[1] ?? null;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (cup >= RANK_TIERS[i]!.min) {
      tier = RANK_TIERS[i]!;
      next = RANK_TIERS[i + 1] ?? null;
    }
  }
  return { tier, next };
}

export function RankBadge({ cup }: { cup: number }) {
  const { tier } = tierFor(cup);
  return (
    <div
      className={
        'group relative inline-flex items-center gap-1.5 rounded-full pl-1 pr-3 py-0.5 text-sm ' +
        'bg-gradient-to-b from-black/55 via-black/35 to-black/60 ring-1 ' + tier.ring +
        ' shadow-[0_2px_8px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
      }
      title={`${tier.name} · ${cup}`}
    >
      <span
        aria-hidden="true"
        className={
          'relative -ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full ' +
          'border border-yellow-700/80 bg-gradient-to-b from-yellow-200 via-yellow-400 to-amber-600 ' +
          'shadow-[0_1px_0_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.7)]'
        }
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]" fill="currentColor" aria-hidden>
          <path d="M7 4h10v2h3v3a4 4 0 0 1-4 4h-.18A5 5 0 0 1 13 15.9V18h2v2H9v-2h2v-2.1A5 5 0 0 1 7.18 13H7a4 4 0 0 1-4-4V6h4V4zm0 4H5v1a2 2 0 0 0 2 2V8zm10 0v3a2 2 0 0 0 2-2V8h-2z" />
        </svg>
      </span>
      <span className={'font-display font-black tabular-nums text-base leading-none ' + tier.text + ' drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]'}>{cup}</span>
    </div>
  );
}
