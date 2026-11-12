/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        navy: { 950: '#0a1630', 900: '#0f1f42', 800: '#16295a', 700: '#1d3672', 600: '#25448c' },
        brand: { 50: '#eef4ff', 100: '#dbe6fe', 200: '#bfd3fe', 300: '#93b4fd', 400: '#608cfa', 500: '#3b68f6', 600: '#2550eb', 700: '#1d3fd8', 800: '#1e35af', 900: '#1e328a' },
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' },
    },
  },
  plugins: [],
};
