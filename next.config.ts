import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "preview-chat-3a056919-a518-4b1c-93e3-d1d49de9c651.space-z.ai",
    "*.space-z.ai",
  ],
};

export default nextConfig;
