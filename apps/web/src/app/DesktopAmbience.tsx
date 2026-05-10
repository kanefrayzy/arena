/**
 * Desktop background — fully static, no animations, no filters that force
 * the GPU into expensive paint/composite cycles. Renders once, then the
 * browser caches it forever. Hidden on mobile.
 *
 * Layers, back to front:
 *   1. Layered radial gradients ("venue" lighting from corners)
 *   2. Single inline SVG sheet with stars, hex mesh, brackets, wordmarks
 *      and stage floor — one paint, no animation
 *   3. Vignette
 */
export function DesktopAmbience() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 hidden overflow-hidden sm:block"
      style={{ zIndex: 0 }}
    >
      {/* Base layered gradients (cheap, GPU-rasterised once). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 12% 0%, rgba(62,224,255,0.18), transparent 60%),' +
            'radial-gradient(ellipse 80% 60% at 88% 0%, rgba(255,79,157,0.18), transparent 60%),' +
            'radial-gradient(ellipse 70% 60% at 50% 55%, rgba(138,79,255,0.22), transparent 70%),' +
            'radial-gradient(ellipse 100% 50% at 50% 100%, rgba(255,209,59,0.10), transparent 70%),' +
            'linear-gradient(180deg, #1a1450 0%, #100b3c 50%, #060225 100%)',
        }}
      />

      {/* Single static SVG sheet — everything decorative in one paint. */}
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1600 900"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Hex pattern (low contrast). */}
          <pattern id="hex" width="56" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M14 0 L42 0 L56 24 L42 48 L14 48 L0 24 Z"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
          </pattern>

          {/* Gradient for left bracket. */}
          <linearGradient id="brkL" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3ee0ff" stopOpacity="0" />
            <stop offset="100%" stopColor="#3ee0ff" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="brkR" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#ff4f9d" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff4f9d" stopOpacity="0.7" />
          </linearGradient>

          {/* Stage floor glow. */}
          <linearGradient id="floor" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgba(255,209,59,0.18)" />
            <stop offset="60%" stopColor="rgba(138,79,255,0.05)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
          <linearGradient id="floorLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,209,59,0)" />
            <stop offset="50%" stopColor="rgba(255,209,59,0.5)" />
            <stop offset="100%" stopColor="rgba(255,209,59,0)" />
          </linearGradient>
        </defs>

        {/* Hex mesh */}
        <rect width="1600" height="900" fill="url(#hex)" />

        {/* Stars — fixed positions, no animation */}
        <g fill="#ffffff">
          <circle cx="120"  cy="80"  r="1" opacity="0.6" />
          <circle cx="320"  cy="160" r="1" opacity="0.4" />
          <circle cx="60"   cy="320" r="1" opacity="0.5" />
          <circle cx="220"  cy="540" r="1" opacity="0.55" />
          <circle cx="380"  cy="700" r="1" opacity="0.45" />
          <circle cx="90"   cy="780" r="1" opacity="0.5" />
          <circle cx="1200" cy="120" r="1" opacity="0.55" />
          <circle cx="1480" cy="240" r="1" opacity="0.45" />
          <circle cx="1380" cy="460" r="1" opacity="0.5" />
          <circle cx="1520" cy="680" r="1" opacity="0.55" />
          <circle cx="1300" cy="820" r="1" opacity="0.5" />
          <circle cx="1100" cy="60"  r="1" opacity="0.4" />
          <circle cx="780"  cy="40"  r="1" opacity="0.5" />
          <circle cx="900"  cy="860" r="1" opacity="0.55" />
        </g>
        <g>
          <circle cx="180"  cy="260" r="1.6" fill="#3ee0ff" opacity="0.7" />
          <circle cx="260"  cy="420" r="1.4" fill="#ffd13b" opacity="0.7" />
          <circle cx="140"  cy="640" r="1.6" fill="#ff4f9d" opacity="0.6" />
          <circle cx="1340" cy="180" r="1.4" fill="#8a4fff" opacity="0.7" />
          <circle cx="1440" cy="380" r="1.6" fill="#3ee0ff" opacity="0.7" />
          <circle cx="1280" cy="600" r="1.4" fill="#ffd13b" opacity="0.6" />
        </g>

        {/* Left bracket */}
        <g transform="translate(80 290)" stroke="url(#brkL)" strokeWidth="1.5" fill="none" opacity="0.55">
          <path d="M0 40 H110 V160 H170" />
          <path d="M0 280 H110 V160" />
          <path d="M0 80 H80" />
          <path d="M0 120 H80" />
          <path d="M0 200 H80" />
          <path d="M0 240 H80" />
          <circle cx="170" cy="160" r="3" fill="#3ee0ff" />
        </g>

        {/* Right bracket */}
        <g transform="translate(1350 290)" stroke="url(#brkR)" strokeWidth="1.5" fill="none" opacity="0.55">
          <path d="M170 40 H60 V160 H0" />
          <path d="M170 280 H60 V160" />
          <path d="M170 80 H90" />
          <path d="M170 120 H90" />
          <path d="M170 200 H90" />
          <path d="M170 240 H90" />
          <circle cx="0" cy="160" r="3" fill="#ff4f9d" />
        </g>

        {/* Vertical wordmarks — stroked text, no fill, no shadow. */}
        <g
          style={{ fontFamily: '"Lilita One", sans-serif' }}
          fontSize="120"
          letterSpacing="38"
          fill="none"
        >
          <text
            x="60"
            y="450"
            stroke="rgba(255,209,59,0.18)"
            strokeWidth="1.5"
            transform="rotate(-90 60 450)"
            textAnchor="middle"
          >
            ARENA · 1V1
          </text>
          <text
            x="1540"
            y="450"
            stroke="rgba(62,224,255,0.18)"
            strokeWidth="1.5"
            transform="rotate(90 1540 450)"
            textAnchor="middle"
          >
            SKILL · BATTLE
          </text>
        </g>

        {/* Stage floor */}
        <rect x="0" y="650" width="1600" height="250" fill="url(#floor)" />
        <rect x="160" y="780" width="1280" height="1" fill="url(#floorLine)" />
      </svg>

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 60%, transparent 0%, transparent 40%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </div>
  );
}
