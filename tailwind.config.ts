import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

export default {
  darkMode: 'class',
  content: ['./renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'hsl(222, 22%, 7%)',
          subtle: 'hsl(222, 20%, 10%)',
          panel: 'hsl(222, 18%, 13%)'
        },
        line: 'hsl(220, 12%, 22%)',
        text: {
          DEFAULT: 'hsl(220, 14%, 92%)',
          muted: 'hsl(220, 10%, 60%)'
        },
        accent: {
          DEFAULT: 'hsl(255, 90%, 66%)',
          hover: 'hsl(255, 90%, 72%)'
        },
        success: 'hsl(142, 70%, 45%)',
        danger: 'hsl(0, 75%, 60%)',
        warn: 'hsl(38, 92%, 60%)'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace']
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite'
      }
    }
  },
  plugins: [animate]
} satisfies Config
