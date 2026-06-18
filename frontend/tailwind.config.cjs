/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#F8FAFC",
        card: "#FFFFFF",
        "text-primary": "#0F172A",
        "text-secondary": "#64748B",
        primary: "#5B5FEF",
        "primary-hover": "#4F46E5",
        border: "#E2E8F0",
        "soft-purple": "#EEF2FF",
        "soft-green": "#ECFDF5",
        "soft-yellow": "#FEFCE8",
        "soft-red": "#FEF2F2",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      boxShadow: {
        soft: "0 8px 24px rgba(15, 23, 42, 0.06)",
      },
      fontFamily: {
        sans: ["Manrope", "Segoe UI", "sans-serif"],
        display: ["Space Grotesk", "Manrope", "sans-serif"],
      },
    },
  },
  plugins: [],
};
