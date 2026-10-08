import type { Config } from "tailwindcss";

// Design tokens live as CSS variables in src/index.css (mirrors the Figma
// "StabiFlow Design System"); this config only exposes them to Tailwind.
// Breakpoints are Tailwind's defaults: sm 640, md 768 (sidebar appears),
// lg 1024, xl 1280, 2xl 1536.
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          hover: "hsl(var(--primary-hover))",
          foreground: "hsl(var(--primary-foreground))",
        },
        selected: {
          DEFAULT: "hsl(var(--selected))",
          foreground: "hsl(var(--selected-foreground))",
        },
        subtle: {
          foreground: "hsl(var(--subtle-foreground))",
        },
        link: "hsl(var(--link))",
        locked: "hsl(var(--locked))",
        success: {
          DEFAULT: "hsl(var(--success))",
          soft: "hsl(var(--success-soft))",
          solid: "hsl(var(--success-solid))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          soft: "hsl(var(--warning-soft))",
          solid: "hsl(var(--warning-solid))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          soft: "hsl(var(--info-soft))",
          solid: "hsl(var(--info-solid))",
        },
        brand: {
          DEFAULT: "hsl(var(--brand))",
          soft: "hsl(var(--brand-soft))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          strong: "hsl(var(--destructive-strong))",
          soft: "hsl(var(--destructive-soft))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      // Type scale (Figma text styles). Body copy stays on Tailwind's
      // text-sm (14/20) and text-xs (12/16).
      fontSize: {
        metric: ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em", fontWeight: "600" }],
        "title-page": ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.018em", fontWeight: "600" }],
        "title-section": ["1rem", { lineHeight: "1.5rem", letterSpacing: "-0.012em", fontWeight: "600" }],
        "title-card": ["0.875rem", { lineHeight: "1.25rem", letterSpacing: "-0.006em", fontWeight: "600" }],
        label: ["0.8125rem", { lineHeight: "1.125rem", fontWeight: "500" }],
        overline: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.055em", fontWeight: "600" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px hsl(220 26% 9% / 0.05)",
        sm: "0 1px 3px hsl(220 26% 9% / 0.08), 0 1px 2px hsl(220 26% 9% / 0.04)",
        md: "0 8px 24px -4px hsl(220 26% 9% / 0.12), 0 2px 6px hsl(220 26% 9% / 0.05)",
        lg: "0 20px 48px -8px hsl(220 26% 9% / 0.18), 0 4px 12px hsl(220 26% 9% / 0.06)",
      },
      spacing: {
        header: "var(--header-height)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        DEFAULT: "var(--duration)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        DEFAULT: "var(--ease-standard)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
