/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:      '#0F1B2D',
        signal:   '#E63946',
        pearl:    '#FFFFFF',
        mist:     '#F5F7FA',
        stone:    '#E1E5EB',
        'stone-2':'#C5CCD3',
        slate:    '#5B6B7E',
        graphite: '#2D3748',
        sky:      '#7AB5D9',
        verde:    '#2A9D8F',
        spark:    '#F4A261',
        plum:     '#7B5BA6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      letterSpacing: {
        'tight-2': '-0.02em',
        'tight-3': '-0.03em',
        'tight-4': '-0.04em',
      },
      maxWidth: {
        'container': '1200px',
      },
    },
  },
  plugins: [],
};
