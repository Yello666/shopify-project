/**
 * PM2：在项目根目录执行 `pm2 start ecosystem.config.cjs`
 * 与 npm start 一致，通过 -r dotenv/config 从项目根目录加载 .env
 */
module.exports = {
  apps: [
    {
      name: "shopify-app",
      cwd: __dirname,
      script: "./node_modules/@react-router/serve/bin.js",
      args: "./build/server/index.js",
      node_args: "-r dotenv/config",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
