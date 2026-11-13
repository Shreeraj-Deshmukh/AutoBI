const shades = (name, steps) => Object.fromEntries(steps.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // standard fonts only (Segoe UI is what Power BI Desktop uses; Arial is the fallback everywhere else)
      fontFamily: { sans: ['"Segoe UI"', 'Arial', 'Helvetica', 'sans-serif'] },
      colors: {
        // CSS variables (src/index.css): the client palette (Sanofi purple / black)
        navy: shades('navy', [950, 900, 800, 700, 600]),
        brand: shades('brand', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' },
    },
  },
  plugins: [],
};
