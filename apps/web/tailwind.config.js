/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F2F5F7',
        surface: '#FFFFFF',
        subtle: '#F6F8FA',
        line: '#E2E8EC',
        'line-strong': '#CCD5DC',
        ink: '#0F1D24',
        'ink-2': '#364852',
        'ink-3': '#66777F',
        accent: '#1F6E9C',
        'accent-strong': '#165578',
        'accent-deep': '#123F5A',
        'accent-fill': '#DBEAF4',
        'accent-soft': '#EDF5FA',
        gain: '#0A8A5F',
        'gain-fill': '#DCF3E8',
        loss: '#D23A2F',
        'loss-fill': '#FDE8E5',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 29, 36, 0.04), 0 4px 12px rgba(15, 29, 36, 0.03)',
      },
      borderRadius: {
        card: '16px',
      },
    },
  },
  plugins: [],
};
