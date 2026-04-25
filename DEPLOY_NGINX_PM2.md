# Shopify 项目部署说明（Nginx + PM2）

这份文档给后续接手人员使用，目标是：拉取代码后，快速、安全地完成上线。

## 0) 一次性前置要求（机器初始化）

- Node 版本要求：`>=20.19 <22` 或 `>=22.12`（见 `package.json`）
- 推荐当前环境：Node `20.19.x`
- 已安装并可用：`pm2`、`nginx`
- 项目路径：`/root/shopify-project`

如果 Node 版本不满足（比如 `v20.18.2`），`npm install` 可能报 `EBADENGINE`。

## 1) 标准部署命令

先进入项目目录：

```bash
cd /root/shopify-project
```

然后执行以下命令：

```bash
npm run build
pm2 restart shopify-app
systemctl start nginx
```

## 2) 每个命令的作用和原因

### `npm run build`

- 作用：构建生产环境产物（`build/client` + `build/server`）。
- 原因： `git pull` 到的是源码，线上运行要用编译后的产物；不 build 可能还是旧页面或直接运行失败。

### `pm2 restart shopify-app`

- 作用：重启 Node 应用进程（名称是 `shopify-app`），让新构建立即生效。
- 原因：只 build 不重启，进程仍可能跑旧内存里的代码。

### `systemctl start nginx`

- 作用：确保 Nginx 服务处于运行状态。
- 原因：Nginx 是入口网关（HTTPS、反向代理到 Node）。若服务没启动，域名访问会失败。

> PS：如果 Nginx 本来就是 active，`start` 再执行一次也安全。

## 3) 这三条命令在大多数日常发版是够用的

但建议补两条“按需命令”：

1. 拉代码后如果依赖有变化（`package.json` / `package-lock.json` 变了），先执行：

```bash
npm install
```

2. Nginx 配置改动后（例如改了 `/etc/nginx/sites-available/shop-ai.cc`），要执行：

```bash
nginx -t && systemctl reload nginx
```

## 4) 发版后校验命令

```bash
pm2 status shopify-app
nginx -t
systemctl is-active nginx
curl -k -I https://127.0.0.1 -H "Host: shop-ai.cc"
```

### 校验项说明和原因

#### `pm2 status shopify-app`

- 看什么：`status` 是否 `online`。
- 为什么：确认应用进程真的活着，而不是刚启动就崩。

#### `nginx -t`

- 看什么：输出是否 `syntax is ok` / `test is successful`。
- 为什么：配置语法错误会导致 reload/start 失败，必须先过语法检查。

#### `systemctl is-active nginx`

- 看什么：输出是否 `active`。
- 为什么：更可靠，直接确认服务状态。

#### `curl -k -I https://127.0.0.1 -H "Host: shop-ai.cc"`

- 看什么：HTTP 状态码、`location` 跳转是否符合预期（当前应跳到 `/app`）。
- 为什么：这是从本机直接验证 Nginx 虚拟主机是否正确接管请求，不依赖外网 DNS。

## 5) 推荐的完整发布流程

```bash
cd /root/shopify-project
git pull
npm install            # 依赖有变化时执行
npm run build
pm2 restart shopify-app
systemctl start nginx

# 发布后校验
pm2 status shopify-app
nginx -t
systemctl is-active nginx
curl -k -I https://127.0.0.1 -H "Host: shop-ai.cc"
```

## 6) 常见故障速查

- `npm install` 报 `EBADENGINE`
  - 原因：Node 版本过低
  - 处理：升级 Node 到 `20.19+`

- `pm2 status` 显示 `errored` / 频繁重启
  - 原因：运行时报错、环境变量问题、构建产物缺失
  - 处理：先看 `pm2 logs shopify-app`

- `systemctl is-active nginx` 不是 `active`
  - 原因：服务未启动或配置错误
  - 处理：先 `nginx -t`，再根据错误修配置并 `systemctl restart nginx`
