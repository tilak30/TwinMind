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
        surface: {
          DEFAULT: "#0f1419",
          raised: "#161d26",
          border: "#243042",
        },
        accent: {
          DEFAULT: "#38bdf8",
          muted: "#0ea5e9",
        },
      },
    },
  },
  plugins: [],
};

export default config;
