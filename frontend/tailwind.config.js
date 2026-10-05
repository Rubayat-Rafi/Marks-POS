/** @type {import('tailwindcss').Config} */

// Mark's Tire Shop & Muffler: deep navy for structure, a confident blue for
// actions. Bright, high-contrast and calm, so the shop reads as trustworthy.
const brand = {
  50: "#eef4ff",
  100: "#dae6ff",
  200: "#bcd3ff",
  300: "#8eb6ff",
  400: "#598cfc",
  500: "#3468f5",
  600: "#1f4fe0",
  700: "#1a3fc0",
  800: "#1b369b",
  900: "#1c327a",
  950: "#141f4a",
  DEFAULT: "#1f4fe0",
};

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand,
        // The staff screens were written against "teal"; it now resolves to
        // the brand blue so every existing button and badge picks up the new
        // look without a rewrite of each page.
        teal: brand,
        ink: {
          DEFAULT: "#0f1d33",
          950: "#070f1f",
          900: "#0b1628",
          800: "#12223b",
          700: "#1a2f4d",
          600: "#2a4468",
          500: "#415c82",
          400: "#6b83a5",
          300: "#9fb1c9",
        },
        accent: {
          DEFAULT: "#f59e0b",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["'Plus Jakarta Sans'", "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 29, 51, 0.04), 0 4px 16px rgba(15, 29, 51, 0.06)",
        lift: "0 10px 30px -10px rgba(15, 29, 51, 0.25)",
      },
    },
  },
  plugins: [],
};
