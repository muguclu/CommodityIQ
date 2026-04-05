import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        commodity: {
          bg: "#020617",       // slate-950
          sidebar: "#0f172a",  // slate-900
          card: "#1e293b",     // slate-800
          border: "#334155",   // slate-700
          accent: "#f59e0b",   // amber-500
          positive: "#10b981", // emerald-500
          negative: "#ef4444", // red-500
          text: "#f1f5f9",     // slate-100
          muted: "#94a3b8",    // slate-400
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(148,163,184,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.03) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-sm": "32px 32px",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "signal-flash": "signalFlash 0.6s ease-out",
        "countdown": "countdown linear forwards",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        signalFlash: {
          "0%":   { opacity: "0.6", transform: "scale(0.98)" },
          "50%":  { opacity: "1",   transform: "scale(1.01)" },
          "100%": { opacity: "1",   transform: "scale(1)" },
        },
        countdown: {
          "0%":   { width: "100%" },
          "100%": { width: "0%" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
