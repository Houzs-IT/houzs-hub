/** @type {import('tailwindcss').Config} */
// Houzs Century "Theme C · Ink & Petrol" — same palette, type and component rhythm
// as Houzs-Century-ERP frontend/tailwind.config.js, so the hub reads as part of the
// family. Values live as RGB channels in src/index.css (:root = light, .dark = dark).
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        "surface-dim": v("surface-dim"),
        raised: { DEFAULT: v("raised"), hover: v("raised-hover") },
        overlay: v("overlay"),
        sunken: v("surface-2"),
        hover: v("surface-2"),
        neutral: { DEFAULT: v("surface-2"), hover: v("surface-dim") },
        ink: { DEFAULT: v("ink"), subtle: v("ink-secondary"), subtlest: v("ink-muted"), disabled: v("ink-disabled") },
        line: { DEFAULT: v("border"), subtle: v("border-subtle"), strong: v("border-strong") },
        // Petrol — the functional accent: buttons, active, links, selected rows.
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), soft: v("primary-soft"), "soft-hover": v("primary-soft-hover"), on: v("primary-on"), ink: v("primary-ink") },
        // Brass — brand signature only (logo, ticket codes, eyebrows). Never a CTA.
        accent: { DEFAULT: v("accent"), soft: v("accent-soft"), bright: v("accent-bright"), ink: v("accent-ink") },
        sidebar: {
          DEFAULT: v("sidebar"),
          ink: v("sidebar-ink"),
          "ink-muted": v("sidebar-ink-muted"),
        },
        loz: {
          grey: v("loz-grey"),
          "grey-ink": v("loz-grey-ink"),
          blue: v("loz-blue"),
          "blue-ink": v("loz-blue-ink"),
          green: v("loz-green"),
          "green-ink": v("loz-green-ink"),
          yellow: v("loz-yellow"),
          "yellow-ink": v("loz-yellow-ink"),
          orange: v("loz-orange"),
          "orange-ink": v("loz-orange-ink"),
          purple: v("loz-purple"),
          "purple-ink": v("loz-purple-ink"),
          red: v("loz-red"),
          "red-ink": v("loz-red-ink"),
        },
        note: { DEFAULT: v("note"), line: v("note-line") },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Noto Sans SC"', "system-ui", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        docno: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", '"Cascadia Mono"', '"Segoe UI Mono"', "Consolas", "monospace"],
      },
      letterSpacing: {
        brand: "0.18em",
        wider: "0.06em",
      },
      boxShadow: {
        stone: "var(--shadow-stone)",
        raised: "var(--shadow-stone)",
        overlay: "var(--shadow-overlay)",
      },
    },
  },
  plugins: [],
};
