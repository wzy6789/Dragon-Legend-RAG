/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // GitHub Pages 静态托管：构建输出到 out/
  output: "export",
  // 仓库名子路径（GitHub Pages 部署在 https://<user>.github.io/<repo>/）
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
