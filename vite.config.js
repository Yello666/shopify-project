import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    proxy: {
      "/api/hotspot": {
        target: "https://shop-ai.xin",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/hotspot/, "/api/v1/hotspot"),
      },
      "/api/auth": {
        target: "https://shop-ai.xin",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/auth/, "/api/v1/auth"),
      },
      "/api/merchant": {
        target: "https://shop-ai.xin",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/merchant/, "/api/v1/merchant"),
      },
      "/api/generate": {
        target: "https://shop-ai.xin",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/generate/, "/api/v1/generate"),
      },
      "/api/content": {
        target: "https://shop-ai.xin",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/content/, "/api/v1/content"),
      },
    },
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
});
