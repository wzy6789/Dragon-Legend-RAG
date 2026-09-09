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
        // 深色墨蓝（背景分层）
        ink: {
          950: "#0a0f1a",
          900: "#0e1524",
          850: "#121a2c",
          800: "#172033",
          700: "#1f2b42",
        },
        // 暖灰（正文/次要文字）
        mist: {
          50: "#f5f6f8",
          100: "#e6e9ee",
          300: "#b6becb",
          400: "#98a2b3",
          500: "#7c8798",
        },
        // 低饱和金（点缀）
        brass: {
          300: "#d9c39a",
          400: "#c9ab77",
          500: "#b3925c",
          600: "#9a7c4c",
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
          "sans-serif",
        ],
        serif: ['"Noto Serif SC"', '"Songti SC"', "SimSun", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
