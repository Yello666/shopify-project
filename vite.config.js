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

/**
 * 对应 Vite `server.hmr`（Hot Module Replacement）选项。
 * @see https://vitejs.dev/config/server-options.html#server-hmr
 */
const serverHmr =
  host === "localhost"
    ? {
        protocol: "ws",
        host: "localhost",
        port: 64999,
        clientPort: 64999,
      }
    : {
        protocol: "wss",
        host,
        port: parseInt(process.env.FRONTEND_PORT, 10) || 8002,
        clientPort: 443,
      };

/** `/api/v1/*` 代理目标（含 WebSocket）；本地联调：`VITE_API_PROXY_TARGET=http://127.0.0.1:8000`。 */
const API_PROXY_TARGET =
  process.env.VITE_API_PROXY_TARGET?.trim() || "https://shop-ai.xin";
const API_PROXY_SECURE =
  process.env.VITE_API_PROXY_INSECURE_SSL === "1"
    ? false
    : API_PROXY_TARGET.startsWith("https:");

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: serverHmr,
    // shopify app dev：同源 `/api/v1/*` 原样转到后端（与生产网关路径一致）；WS 同上。
    proxy: {
      "/api/v1": {
        //选择本地开发环境和线上环境
       target: "https://shop-ai.xin",
       //target: "http://localhost:8000",
        changeOrigin: true,
        ws: true,
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
