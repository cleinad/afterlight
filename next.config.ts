import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  ...(process.env.AFTERLIGHT_DESKTOP === "1"
    ? { output: "export" as const }
    : {
        async rewrites() {
          return [
            {
              source: "/ollama/chat",
              destination: "http://127.0.0.1:11434/api/chat",
            },
            {
              source: "/ollama/models",
              destination: "http://127.0.0.1:11434/api/tags",
            },
          ];
        },
      }),
};

export default config;
