/**
 * Desktop background. The 9:16 portrait sits in the middle of the screen on
 * desktop; this fills everything around it with a cinematic "tournament
 * stage" environment so the empty space stops feeling empty.
 *
 * Layers, back to front:
 *   1. Deep gradient + vignette (the "venue")
 *   2. Animated starfield (depth)
 *   3. Hexagonal honeycomb mesh (subtle texture)
 *   4. Two cinematic spotlight beams from top corners
 *   5. A pulsing portal / halo behind where the phone-frame sits
 *   6. Drifting geometric particles (triangles, diamonds)
 *   7. Tournament-bracket line decorations on each side
 *   8. Vertical brand wordmarks far left/right (xl+)
 *   9. Stage floor with reflection glow
 *  10. Subtle scanline overlay
 *
 * Hidden on mobile — the portrait already fills the screen there.
 */
export function DesktopAmbience() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 hidden overflow-hidden sm:block"
      style={{ zIndex: 0 }}
    >
      {/* 1. Base gradient + vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#241b66_0%,_#1a1450_28%,_#0d0938_60%,_#050218_100%)]" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 60%, transparent 0%, transparent 35%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* 2. Starfield (CSS-only twinkle) */}
      <div className="amb-stars amb-stars-1" />
      <div className="amb-stars amb-stars-2" />
      <div className="amb-stars amb-stars-3" />

      {/* 3. Hexagonal mesh */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='48' viewBox='0 0 56 48'><path d='M14 0 L42 0 L56 24 L42 48 L14 48 L0 24 Z' fill='none' stroke='%23ffffff' stroke-width='1'/></svg>\")",
          backgroundSize: '56px 48px',
        }}
      />

      {/* 4. Spotlights from top corners */}
      <div
        className="absolute left-[-10vw] top-[-20vh] h-[140vh] w-[60vw] origin-top-left rotate-[20deg] opacity-30 mix-blend-screen"
        style={{
          background:
            'linear-gradient(to bottom, rgba(62,224,255,0.45) 0%, rgba(62,224,255,0.18) 35%, transparent 75%)',
          filter: 'blur(40px)',
          animation: 'amb-spot 14s ease-in-out infinite alternate',
        }}
      />
      <div
        className="absolute right-[-10vw] top-[-20vh] h-[140vh] w-[60vw] origin-top-right -rotate-[20deg] opacity-30 mix-blend-screen"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255,79,157,0.45) 0%, rgba(255,79,157,0.18) 35%, transparent 75%)',
          filter: 'blur(40px)',
          animation: 'amb-spot 17s ease-in-out infinite alternate-reverse',
        }}
      />

      {/* 5. Pulsing halo / portal behind the portrait */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className="amb-halo"
          style={{
            background:
              'conic-gradient(from 0deg, #8a4fff, #3ee0ff, #ff4f9d, #ffd13b, #8a4fff)',
          }}
        />
        <div className="amb-halo-inner" />
      </div>

      {/* 6. Drifting geometric particles */}
      <Particle className="left-[8%] top-[18%]" shape="triangle" color="#3ee0ff" delay="0s" duration="22s" />
      <Particle className="left-[14%] top-[68%]" shape="diamond" color="#ffd13b" delay="-5s" duration="28s" />
      <Particle className="left-[22%] top-[40%]" shape="triangle" color="#8a4fff" delay="-12s" duration="24s" />
      <Particle className="right-[8%] top-[28%]" shape="diamond" color="#ff4f9d" delay="-3s" duration="26s" />
      <Particle className="right-[16%] top-[72%]" shape="triangle" color="#3ee0ff" delay="-9s" duration="30s" />
      <Particle className="right-[24%] top-[52%]" shape="diamond" color="#ffd13b" delay="-15s" duration="20s" />

      {/* 7. Tournament-bracket line decorations */}
      <BracketLeft />
      <BracketRight />

      {/* 8. Vertical brand wordmarks (only on wide screens) */}
      <div
        className="absolute left-[1.5vw] top-1/2 hidden -translate-y-1/2 select-none font-display uppercase tracking-[0.45em] xl:block"
        style={{
          writingMode: 'vertical-rl',
          transform: 'translateY(-50%) rotate(180deg)',
          fontSize: 'clamp(3rem, 7vw, 7rem)',
          color: 'transparent',
          WebkitTextStroke: '1.5px rgba(255,209,59,0.18)',
          textShadow: '0 0 40px rgba(255,209,59,0.25)',
        }}
      >
        ARENA · 1V1
      </div>
      <div
        className="absolute right-[1.5vw] top-1/2 hidden -translate-y-1/2 select-none font-display uppercase tracking-[0.45em] xl:block"
        style={{
          writingMode: 'vertical-rl',
          fontSize: 'clamp(3rem, 7vw, 7rem)',
          color: 'transparent',
          WebkitTextStroke: '1.5px rgba(62,224,255,0.18)',
          textShadow: '0 0 40px rgba(62,224,255,0.25)',
        }}
      >
        SKILL · BATTLE
      </div>

      {/* 9. Stage floor */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[28vh]"
        style={{
          background:
            'linear-gradient(to top, rgba(255,209,59,0.12) 0%, rgba(138,79,255,0.06) 30%, transparent 100%)',
        }}
      />
      <div
        className="absolute bottom-[14vh] left-1/2 h-px w-[80vw] -translate-x-1/2"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(255,209,59,0.35) 50%, transparent)',
          filter: 'blur(0.5px)',
        }}
      />

      {/* 10. Scanlines */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 3px)',
        }}
      />

      <style>{`
        @keyframes amb-spot {
          0%   { opacity: 0.22; transform: rotate(20deg) translateX(0); }
          100% { opacity: 0.38; transform: rotate(22deg) translateX(2vw); }
        }
        @keyframes amb-spin-slow { to { transform: translate(-50%, -50%) rotate(360deg); } }
        @keyframes amb-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1);   opacity: 0.55; }
          50%      { transform: translate(-50%, -50%) scale(1.08); opacity: 0.85; }
        }
        @keyframes amb-drift {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 0; }
          10%  { opacity: 0.65; }
          90%  { opacity: 0.65; }
          100% { transform: translate(8vw, -55vh) rotate(540deg); opacity: 0; }
        }
        @keyframes amb-twinkle {
          0%, 100% { opacity: 0.25; }
          50%      { opacity: 1; }
        }

        /* Starfield: layered radial-gradient dots, animated twinkle. */
        .amb-stars {
          position: absolute; inset: 0;
          background-repeat: repeat;
          animation: amb-twinkle 4s ease-in-out infinite;
        }
        .amb-stars-1 {
          background-image:
            radial-gradient(1px 1px at 12% 18%, #fff 100%, transparent),
            radial-gradient(1px 1px at 27% 67%, #fff 100%, transparent),
            radial-gradient(1px 1px at 41% 12%, #fff 100%, transparent),
            radial-gradient(1px 1px at 58% 81%, #fff 100%, transparent),
            radial-gradient(1px 1px at 72% 35%, #fff 100%, transparent),
            radial-gradient(1px 1px at 89% 58%, #fff 100%, transparent),
            radial-gradient(1px 1px at 5% 88%, #fff 100%, transparent),
            radial-gradient(1px 1px at 95% 22%, #fff 100%, transparent);
          background-size: 100% 100%;
          opacity: 0.5;
        }
        .amb-stars-2 {
          background-image:
            radial-gradient(1.5px 1.5px at 18% 42%, #ffd13b 100%, transparent),
            radial-gradient(1.5px 1.5px at 64% 18%, #3ee0ff 100%, transparent),
            radial-gradient(1.5px 1.5px at 33% 88%, #ff4f9d 100%, transparent),
            radial-gradient(1.5px 1.5px at 82% 73%, #8a4fff 100%, transparent);
          background-size: 100% 100%;
          opacity: 0.6;
          animation-duration: 6s;
          animation-delay: -2s;
        }
        .amb-stars-3 {
          background-image:
            radial-gradient(1px 1px at 7% 35%, #fff 100%, transparent),
            radial-gradient(1px 1px at 24% 82%, #fff 100%, transparent),
            radial-gradient(1px 1px at 53% 47%, #fff 100%, transparent),
            radial-gradient(1px 1px at 78% 14%, #fff 100%, transparent),
            radial-gradient(1px 1px at 91% 91%, #fff 100%, transparent);
          background-size: 100% 100%;
          opacity: 0.4;
          animation-duration: 5s;
          animation-delay: -1s;
        }

        /* Halo behind the portrait — rotating conic ring + soft inner glow. */
        .amb-halo {
          position: absolute; left: 50%; top: 50%;
          transform: translate(-50%, -50%);
          width: 95vh; height: 95vh; max-width: 92vmin; max-height: 92vmin;
          border-radius: 9999px;
          filter: blur(80px);
          opacity: 0.28;
          animation: amb-spin-slow 90s linear infinite;
        }
        .amb-halo-inner {
          position: absolute; left: 50%; top: 50%;
          transform: translate(-50%, -50%);
          width: 70vh; height: 70vh; max-width: 70vmin; max-height: 70vmin;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(138,79,255,0.35) 0%, rgba(62,224,255,0.18) 40%, transparent 70%);
          filter: blur(60px);
          animation: amb-pulse 6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function Particle({
  className,
  shape,
  color,
  delay,
  duration,
}: {
  className: string;
  shape: 'triangle' | 'diamond';
  color: string;
  delay: string;
  duration: string;
}) {
  const size = 14;
  const common: React.CSSProperties = {
    width: size,
    height: size,
    background: color,
    boxShadow: `0 0 16px ${color}`,
    animation: `amb-drift ${duration} linear infinite`,
    animationDelay: delay,
  };
  return (
    <div
      className={`absolute ${className}`}
      style={
        shape === 'triangle'
          ? { ...common, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }
          : { ...common, transform: 'rotate(45deg)' }
      }
    />
  );
}

function BracketLeft() {
  return (
    <svg
      className="absolute left-[3vw] top-1/2 hidden -translate-y-1/2 opacity-[0.18] lg:block"
      width="180"
      height="320"
      viewBox="0 0 180 320"
      fill="none"
    >
      <defs>
        <linearGradient id="brk-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3ee0ff" stopOpacity="0" />
          <stop offset="100%" stopColor="#3ee0ff" stopOpacity="1" />
        </linearGradient>
      </defs>
      <g stroke="url(#brk-l)" strokeWidth="1.5" fill="none">
        <path d="M10 40 H110 V160 H170" />
        <path d="M10 280 H110 V160" />
        <path d="M10 80 H80" />
        <path d="M10 120 H80" />
        <path d="M10 200 H80" />
        <path d="M10 240 H80" />
      </g>
      <g fill="#3ee0ff">
        <circle cx="170" cy="160" r="3" />
        <circle cx="110" cy="40" r="2" opacity="0.6" />
        <circle cx="110" cy="280" r="2" opacity="0.6" />
      </g>
    </svg>
  );
}

function BracketRight() {
  return (
    <svg
      className="absolute right-[3vw] top-1/2 hidden -translate-y-1/2 opacity-[0.18] lg:block"
      width="180"
      height="320"
      viewBox="0 0 180 320"
      fill="none"
    >
      <defs>
        <linearGradient id="brk-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="#ff4f9d" stopOpacity="0" />
          <stop offset="100%" stopColor="#ff4f9d" stopOpacity="1" />
        </linearGradient>
      </defs>
      <g stroke="url(#brk-r)" strokeWidth="1.5" fill="none">
        <path d="M170 40 H70 V160 H10" />
        <path d="M170 280 H70 V160" />
        <path d="M170 80 H100" />
        <path d="M170 120 H100" />
        <path d="M170 200 H100" />
        <path d="M170 240 H100" />
      </g>
      <g fill="#ff4f9d">
        <circle cx="10" cy="160" r="3" />
        <circle cx="70" cy="40" r="2" opacity="0.6" />
        <circle cx="70" cy="280" r="2" opacity="0.6" />
      </g>
    </svg>
  );
}
