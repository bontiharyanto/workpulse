import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Semantic scale (Untitled UI cadence) — used alongside
        // Tailwind's default `text-xs`..`text-6xl` for ad-hoc sizing.
        // Rule of thumb: use these tokens whenever the intent is
        // "this is a page title / a subtitle / a caption". Fall back
        // to raw sizes for one-off adjustments.
        overline: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.06em', fontWeight: '500' }],
        caption: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        body: ['0.875rem', { lineHeight: '1.5' }],
        'body-lg': ['1rem', { lineHeight: '1.5' }],
        h6: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '600' }],
        h5: ['1rem', { lineHeight: '1.375rem', fontWeight: '600' }],
        h4: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        h3: ['1.25rem', { lineHeight: '1.625rem', fontWeight: '600', letterSpacing: '-0.005em' }],
        h2: ['1.5rem', { lineHeight: '1.875rem', fontWeight: '600', letterSpacing: '-0.01em' }],
        h1: ['1.875rem', { lineHeight: '2.25rem', fontWeight: '600', letterSpacing: '-0.015em' }],
        'display-sm': [
          '2.25rem',
          { lineHeight: '2.5rem', fontWeight: '700', letterSpacing: '-0.02em' },
        ],
        'display-md': [
          '3rem',
          { lineHeight: '3.25rem', fontWeight: '700', letterSpacing: '-0.02em' },
        ],
        'display-lg': [
          '3.75rem',
          { lineHeight: '4rem', fontWeight: '700', letterSpacing: '-0.025em' },
        ],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        module: {
          attendance: 'hsl(var(--module-attendance))',
          leave: 'hsl(var(--module-leave))',
          overtime: 'hsl(var(--module-overtime))',
          timesheet: 'hsl(var(--module-timesheet))',
          admin: 'hsl(var(--module-admin))',
        },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // Two-tier shadow scale.
        //
        //  1. Surface shadows (`xs`, `sm`) — for elements that sit
        //     ON the page (cards, buttons, inputs). Kept intentionally
        //     subtle so the UI reads as flat / Notion-quiet.
        //  2. Floating shadows (`md`, `lg`, `popover`, `modal`) — for
        //     elements that are supposed to visually DETACH from the
        //     page (dropdowns, popovers, dialogs, sheets, toast).
        //     These need real elevation because in a mostly-white
        //     design system a soft shadow lets the surface bleed into
        //     the content behind it and looks like a bug.
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        sm: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        md: '0 4px 8px -2px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
        lg: '0 12px 24px -4px rgb(0 0 0 / 0.12), 0 4px 8px -4px rgb(0 0 0 / 0.08)',
        // Bespoke stack used by every portalled surface. Two layers
        // for a real ambient penumbra plus a crisp key light — reads
        // as a hovering card without looking like a drop-shadow.
        popover:
          '0 8px 16px -4px rgb(0 0 0 / 0.10), 0 4px 8px -2px rgb(0 0 0 / 0.06), 0 0 0 1px rgb(0 0 0 / 0.02)',
        modal:
          '0 24px 48px -12px rgb(0 0 0 / 0.18), 0 8px 16px -8px rgb(0 0 0 / 0.10), 0 0 0 1px rgb(0 0 0 / 0.04)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
