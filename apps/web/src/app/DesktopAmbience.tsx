/**
 * DesktopAmbience — fills the empty space on either side of the 9:16 portrait
 * frame on desktop. Hidden on mobile where the portrait already covers the
 * full screen.
 *
 * Layered effects:
 *   1. Animated conic+radial gradient using the brand palette
 *   2. Slowly drifting blurred "orbs" of accent colors
 *   3. Subtle dot/grid scanlines for texture
 *   4. Vertical brand wordmarks on the far left/right
 *   5. Soft halo glow around the portrait frame edges
 */
export function DesktopAmbience() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 hidden overflow-hidden sm:block"
    >
      {/* Base radial vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, #2a1f7a 0%, #1a1450 35%, #0d0938 70%, #050218 100%)',
        }}
      />

      {/* Slow rotating conic glow */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-40"
        style={{
          width: '160vmax',
          height: '160vmax',
          background:
            'conic-gradient(from 0deg, transparent 0deg, rgba(138,79,255,0.18) 60deg, transparent 120deg, rgba(62,224,255,0.18) 180deg, transparent 240deg, rgba(255,79,157,0.18) 300deg, transparent 360deg)',
          animation: 'amb-spin 60s linear infinite',
          filter: 'blur(40px)',
        }}
      />

      {/* Floating colored orbs */}
      <Orb className="left-[6%] top-[12%]" color="#8a4fff" size={420} delay="0s" />
      <Orb className="right-[8%] top-[18%]" color="#3ee0ff" size={360} delay="-7s" />
      <Orb className="left-[10%] bottom-[8%]" color="#ff4f9d" size={380} delay="-14s" />
      <Orb className="right-[5%] bottom-[12%]" color="#ffd13b" size={300} delay="-21s" />

      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Vertical brand wordmark on far left */}
      <div
        className="absolute left-[3vw] top-1/2 hidden -translate-y-1/2 select-none font-display text-[clamp(2.5rem,6vw,5.5rem)] uppercase tracking-[0.4em] opacity-[0.06] xl:block"
        style={{
          writingMode: 'vertical-rl',
          transform: 'translateY(-50%) rotate(180deg)',
          color: '#ffd13b',
          textShadow: '0 0 30px rgba(255,209,59,0.5)',
        }}
      >
        ARENA 1v1
      </div>
      {/* Vertical brand wordmark on far right */}
      <div
        className="absolute right-[3vw] top-1/2 hidden -translate-y-1/2 select-none font-display text-[clamp(2.5rem,6vw,5.5rem)] uppercase tracking-[0.4em] opacity-[0.06] xl:block"
        style={{
          writingMode: 'vertical-rl',
          color: '#3ee0ff',
          textShadow: '0 0 30px rgba(62,224,255,0.5)',
        }}
      >
        BATTLE ROYALE
      </div>

      {/* Bottom edge: faint horizon glow */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[18vh]"
        style={{
          background:
            'linear-gradient(to top, rgba(255,209,59,0.07), transparent)',
        }}
      />

      <style>{`
        @keyframes amb-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
        @keyframes amb-float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25%      { transform: translate(40px, -30px) scale(1.08); }
          50%      { transform: translate(-25px, 35px) scale(0.95); }
          75%      { transform: translate(20px, 20px) scale(1.05); }
        }
      `}</style>
    </div>
  );
}

function Orb({
  className,
  color,
  size,
  delay,
}: {
  className: string;
  color: string;
  size: number;
  delay: string;
}) {
  return (
    <div
      className={`absolute rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color}55 0%, ${color}22 40%, transparent 70%)`,
        filter: 'blur(30px)',
        animation: `amb-float 28s ease-in-out infinite`,
        animationDelay: delay,
      }}
    />
  );
}
