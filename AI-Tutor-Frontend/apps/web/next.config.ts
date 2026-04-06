import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ai-tutor/types", "@ai-tutor/ui"],
};

export default nextConfig;
