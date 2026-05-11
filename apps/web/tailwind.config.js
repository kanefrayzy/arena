/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brawl-inspired palette. Legacy aliases (bg/surface/accent) kept
        // so existing pages stay readable until each is migrated.
        bg: '#1a1450',
        surface: '#241b66',
        accent: '#ffd13b',
        'game-bg': '#1a1450',
        'game-bg-2': '#0d0938',
        'game-surface': '#2a1f7a',
        'game-surface-2': '#3a2a9e',
        'game-yellow': '#ffd13b',
        'game-yellow-dark': '#e0a800',
        'game-orange': '#ff7a1a',
        'game-pink': '#ff4f9d',
        'game-purple': '#8a4fff',
        'game-cyan': '#3ee0ff',
        'game-green': '#3eff8b',
        'game-red': '#ff3e5c',
      },
      fontFamily: {
        display: ['"Lilita One"', 'system-ui', 'sans-serif'],
        body: ['Fredoka', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'game-yellow': '0 6px 0 0 #b88200, 0 8px 18px rgba(255,209,59,0.45)',
        'game-yellow-press': '0 2px 0 0 #b88200, 0 3px 8px rgba(255,209,59,0.4)',
        'game-purple': '0 6px 0 0 #4a2eb8, 0 8px 18px rgba(138,79,255,0.4)',
        'game-purple-press': '0 2px 0 0 #4a2eb8, 0 3px 8px rgba(138,79,255,0.35)',
        'game-pink': '0 6px 0 0 #b8326e, 0 8px 18px rgba(255,79,157,0.4)',
        'game-pink-press': '0 2px 0 0 #b8326e, 0 3px 8px rgba(255,79,157,0.35)',
        'game-card': '0 4px 0 0 rgba(0,0,0,0.45), 0 12px 24px rgba(0,0,0,0.35)',
        'game-card-hover': '0 6px 0 0 rgba(0,0,0,0.5), 0 16px 32px rgba(0,0,0,0.4)',
        'game-glow-yellow': '0 0 24px rgba(255,209,59,0.5)',
        'game-glow-cyan': '0 0 24px rgba(62,224,255,0.5)',
      },
      backgroundImage: {
        'game-bg-gradient':
          'radial-gradient(ellipse at 50% 0%, #3a2a9e 0%, #1a1450 50%, #0d0938 100%)',
      },
      animation: {
        'pop-in': 'popIn 280ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        shimmer: 'shimmer 2.5s linear infinite',
        float: 'float 3s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 1.6s ease-in-out infinite',
        bell: 'bellShake 1.6s ease-in-out infinite',
        'slide-in-left': 'slideInLeft 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'slide-in-right': 'slideInRight 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'pop-vs': 'popVS 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.25s both',
        'count-pop': 'countPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'cup-pop': 'cupPop 1.1s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        popIn: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 16px rgba(255,209,59,0.4)' },
          '50%': { boxShadow: '0 0 32px rgba(255,209,59,0.8)' },
        },
        bellShake: {
          '0%, 60%, 100%': { transform: 'rotate(0deg)' },
          '10%, 30%, 50%': { transform: 'rotate(-12deg)' },
          '20%, 40%': { transform: 'rotate(12deg)' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-120%) rotate(-8deg)', opacity: '0' },
          '70%': { transform: 'translateX(8%) rotate(2deg)', opacity: '1' },
          '100%': { transform: 'translateX(0) rotate(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(120%) rotate(8deg)', opacity: '0' },
          '70%': { transform: 'translateX(-8%) rotate(-2deg)', opacity: '1' },
          '100%': { transform: 'translateX(0) rotate(0)', opacity: '1' },
        },
        popVS: {
          '0%': { transform: 'translate(-50%, -50%) scale(0) rotate(-45deg)', opacity: '0' },
          '60%': { transform: 'translate(-50%, -50%) scale(1.25) rotate(8deg)', opacity: '1' },
          '100%': { transform: 'translate(-50%, -50%) scale(1) rotate(0)', opacity: '1' },
        },
        countPop: {
          '0%': { transform: 'scale(0.4)', opacity: '0' },
          '40%': { transform: 'scale(1.25)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        cupPop: {
          '0%':   { transform: 'translateY(0)    scale(0.4)', opacity: '0' },
          '30%':  { transform: 'translateY(-14px) scale(1.35)', opacity: '1' },
          '70%':  { transform: 'translateY(-8px)  scale(1.1)',  opacity: '1' },
          '100%': { transform: 'translateY(0)    scale(1)',    opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
