/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d12',
        surface: '#141821',
        accent: '#00e0ff',
      },
    },
  },
  plugins: [],
};
