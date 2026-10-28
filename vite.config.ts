import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [cloudflareDevProxy({
    configPath: mode === "demo" || mode === "public-demo" ? "wrangler.demo.jsonc" : "wrangler.jsonc",
  }), reactRouter()],
}));
