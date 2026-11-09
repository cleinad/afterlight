import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
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
};

export default config;
