/**
 * Lightweight victory confetti / particle burst for the result screen.
 *
 * Pure CSS animation (no canvas, no rAF loop, no JS particle system) — the
 * pieces are absolutely positioned `<i>` elements with randomized inline
 * `--x/--y/--r/--c/--d` CSS variables consumed by a single keyframe defined
 * in tailwind.config.js (`confetti-fall`). This keeps the FX virtually free
 * on the main thread even on weak devices.
 */
import { useMemo } from 'react';

const COLORS = [
  '#ffd13b', // game-yellow
  '#22ddff', // game-cyan
  '#ff5fa2', // game-pink
  '#aa7bff', // game-purple
  '#ffffff',
];

interface Props {
  /** 'win' triggers the burst; other outcomes render nothing. */
  outcome: 'win' | 'loss' | 'draw';
  count?: number;
}

export function ResultFx({ outcome, count = 60 }: Props) {
  const pieces = useMemo(() => {
    if (outcome !== 'win') return [];
    return Array.from({ length: count }, (_, i) => {
      const xStart = Math.random() * 100; // vw spawn position (top of viewport)
      const xDrift = (Math.random() - 0.5) * 30; // horizontal drift (vw)
      const rot = Math.floor(Math.random() * 720 - 360); // total rotation
      const dur = 1800 + Math.random() * 2200; // ms
      const delay = Math.random() * 600;
      const color = COLORS[i % COLORS.length];
      const size = 6 + Math.random() * 8;
      const shape = Math.random() < 0.5 ? '50%' : '2px'; // circle or square
      return { xStart, xDrift, rot, dur, delay, color, size, shape, key: i };
    });
  }, [outcome, count]);

  if (outcome !== 'win') return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <i
          key={p.key}
          className="animate-confetti-fall absolute block"
          style={{
            left: `${p.xStart}vw`,
            top: '-5vh',
            width: `${p.size}px`,
            height: `${p.size * 0.6}px`,
            background: p.color,
            borderRadius: p.shape,
            animationDuration: `${p.dur}ms`,
            animationDelay: `${p.delay}ms`,
            // CSS vars consumed by the `confetti-fall` keyframe
            ['--cx' as never]: `${p.xDrift}vw`,
            ['--cr' as never]: `${p.rot}deg`,
            boxShadow: `0 0 6px ${p.color}66`,
          }}
        />
      ))}
    </div>
  );
}
