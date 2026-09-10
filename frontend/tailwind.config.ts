import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 页面底色与面板（干净深色，不做渐变堆叠）
        base: "#0D0F12",
        panel: "#15181D",
        panelAlt: "#1A1E24",
        // 文字
        ink: {
          DEFAULT: "#F1F3F5",
          soft: "#C7CCD3",
          muted: "#9AA1AA",
          faint: "#7C838C",
        },
        // 低饱和金（仅品牌强调）
        gold: {
          300: "#E0C766",
          400: "#D9B84A",
          500: "#C9A227",
          600: "#A8871F",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Source Han Sans SC"',
          "sans-serif",
        ],
        serif: [
          '"Noto Serif SC"',
          '"Source Han Serif SC"',
          '"Songti SC"',
          "SimSun",
          "Georgia",
          "serif",
        ],
      },
      maxWidth: {
        thread: "768px",
        composer: "840px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "dot-pulse": {
          "0%, 80%, 100%": { opacity: "0.25" },
          "40%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 220ms ease-out both",
        "dot-pulse": "dot-pulse 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
