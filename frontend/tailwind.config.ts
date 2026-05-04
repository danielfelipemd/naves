import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        inalde: {
          red: '#e30613',
          'red-dark': '#cc292b',
          'red-hover': '#b30510',
          blue: '#224d7c',
          gold: '#9f885f',
          black: '#000000',
          text: '#1a1a1a',
          gray: '#6b6b6b',
          'gray-light': '#e8e8e8',
          'gray-bg': '#f5f5f5',
          white: '#ffffff',
        },
      },
      fontFamily: {
        primary: ['Montserrat', 'system-ui', 'sans-serif'],
        body: ['Roboto', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        wider: '0.05em',
        widest: '0.15em',
      },
      boxShadow: {
        'inalde-card': '0 2px 8px rgba(0,0,0,0.06)',
        'inalde-card-hover': '0 4px 12px rgba(227, 6, 19, 0.1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
