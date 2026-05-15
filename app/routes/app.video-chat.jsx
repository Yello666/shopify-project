import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router";
import "../styles/video-chat.css";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { authFetch, getAccessToken } from "../utils/auth-api";
import {
  classifyReferenceFileStrict,
  validateAudioFile,
  validateImageFile,
  validateReferenceAggregates,
  validateRequestBodyUnderLimit,
  validateVideoFile,
  REFERENCE_ASSETS_RULES_SECTIONS,
} from "../utils/video-reference-validation";
import { Button, Dropdown, Input, message as antMessage, Modal, Select, Switch, Tooltip } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ArrowUpOutlined,
  DownOutlined,
  SettingOutlined,
  ShareAltOutlined,
  CopyOutlined,
  ReloadOutlined,
  LikeOutlined,
  DislikeOutlined,
  HistoryOutlined,
  GiftOutlined,
  InfoCircleOutlined,
  QuestionCircleOutlined,
  CloseOutlined,
} from "@ant-design/icons";

const EMPTY_MESSAGES = [];

const WELCOME_TEXT =
  "你好～我是你的视频生成助手，请你把你对于视频的想法输入对话框（如视频剧情、视频氛围），我会帮你生成视频～";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const EMPTY_PENDING_REFERENCE_ASSETS = { images: [], audios: [], videos: [] };

/** 文件名显示：主名前 15 个 Unicode 字形 + 扩展名（含点，小写） */
function formatReferenceAssetChipLabel(fileName) {
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  const base = raw.split(/[/\\]/).pop() || "";
  const n = base || "file";
  const lastDot = n.lastIndexOf(".");
  const stem = lastDot >= 0 ? n.slice(0, lastDot) : n;
  const extRaw = lastDot >= 0 ? n.slice(lastDot) : "";
  const glyphs = Array.from(stem);
  const head = glyphs.slice(0, 15).join("");
  const extShow = extRaw ? extRaw.toLowerCase() : "";
  return `${head}${extShow}`;
}

/** 与推广商品主图 URL 同步：仅用于 chip 标签与 File 名称，不上传本体 */
function inferProductReferenceFileName(imageUrl, productName) {
  const url = typeof imageUrl === "string" ? imageUrl.trim() : "";
  let base = "";
  if (url) {
    try {
      const path = url.replace(/\?[\s\S]*$/, "").split("/").pop() || "";
      base = decodeURIComponent(path);
    } catch {
      base = url.split("/").pop()?.split("?")[0] || "";
    }
  }
  const extMatch = base.match(/\.(jpe?g|png|webp|bmp|tiff?|gif)$/i);
  const extFromUrl = extMatch ? extMatch[0].toLowerCase() : ".jpg";

  const stem = typeof productName === "string" ? productName.trim().slice(0, 48) : "";
  if (stem) {
    return `${stem.replace(/[/\\?%*:|"<>]/g, "_")}${extFromUrl}`;
  }

  if (base && /\.(jpe?g|png|webp|bmp|tiff?|gif)$/i.test(base)) {
    return base.slice(0, 120);
  }
  return "商品图.jpg";
}

/** 推广商品主图：直接使用页面已有 HTTPS 地址写入首图，打开即显示 chip，无需二次拉取转 Base64 */
function createBootstrapProductImageEntry(imageUrl, productName) {
  const url = typeof imageUrl === "string" ? imageUrl.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const fileName = inferProductReferenceFileName(url, productName);
  const mime = /\.png$/i.test(fileName)
    ? "image/png"
    : /\.webp$/i.test(fileName)
      ? "image/webp"
      : /\.gif$/i.test(fileName)
        ? "image/gif"
        : /\.bmp$/i.test(fileName)
          ? "image/bmp"
          : /\.(tif|tiff)$/i.test(fileName)
            ? "image/tiff"
            : "image/jpeg";
  return {
    file: new File([], fileName, { type: mime }),
    /** 本地选择的参考图为该字段；此处为远端 URL（与 DEMO_CREATE_THREAD_PAYLOAD 一致） */
    dataUrl: null,
    remoteUrl: url,
    meta: {},
    fromBootstrapProduct: true,
  };
}

/** 从当前会话聊天记录中的「推广产品」上下文取商品图 URL（与卡片同源） */
function findBootstrapProductImageInMessages(messageList) {
  if (!Array.isArray(messageList)) return null;
  for (let i = messageList.length - 1; i >= 0; i--) {
    const m = messageList[i];
    const raw =
      typeof m?.bootstrapContext?.product?.image_url === "string"
        ? m.bootstrapContext.product.image_url.trim()
        : "";
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    const name =
      typeof m?.bootstrapContext?.product?.name === "string" ? m.bootstrapContext.product.name.trim() : "";
    return { url: raw, name };
  }
  return null;
}

function getUserReferenceAssets(pending) {
  const { images = [], audios = [], videos = [] } = pending || {};
  return {
    images: images.filter((x) => !x?.fromBootstrapProduct),
    audios,
    videos,
  };
}

/** entries: { file, dataUrl?, remoteUrl? }[] → create 载荷 */
function buildPendingMediaAssetsPayload(pending) {
  const { images = [], audios = [], videos = [] } = getUserReferenceAssets(pending);
  const assets = {};
  if (images.length) {
    assets.ref_image_urls = images
      .map((x) => (x.dataUrl ? x.dataUrl : x.remoteUrl))
      .filter((u) => typeof u === "string" && u.trim());
  }
  if (audios.length) {
    assets.reference_audio_urls = audios
      .map((x) => (x.dataUrl ? x.dataUrl : x.remoteUrl))
      .filter((u) => typeof u === "string" && u.trim());
  }
  if (videos.length) {
    assets.reference_video_urls = videos
      .map((x) => (x.dataUrl ? x.dataUrl : x.remoteUrl))
      .filter((u) => typeof u === "string" && u.trim());
  }
  return Object.keys(assets).length ? assets : null;
}

const DEFAULT_VIDEO_PARAMS = {
  resolution: "720p",
  ratio: "adaptive",
  watermark: true,
  generateAudio: true,
  /** 固定多模态，不在界面切换 */
  generationMode: "multimodal_reference",
  referenceUsageDescription: "",
  responseLang: "zh",
  firstFrameList: [],
  lastFrameList: [],
};

const RESOLUTION_OPTIONS = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
];

const RATIO_OPTIONS = [
  { value: "adaptive", label: "adaptive（自适应）" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "9:16", label: "9:16" },
  { value: "21:9", label: "21:9" },
];

const RESPONSE_LANG_OPTIONS = [
  { value: "zh", label: "中文（zh）" },
  { value: "en", label: "英文（en）" },
];
const MERCHANT_API_BASE = "/api/v1/merchant";
const VIDEO_THREAD_API_BASE = "/api/v1/video-thread";
const UPLOAD_FILE_API = "/api/v1/upload/file";
/** 与后端约定：统一多模态生成（文案、参考素材等由服务端一并理解） */
const BACKEND_GENERATION_MODE_MULTIMODAL = "multimodal_reference";
const VIDEO_CHAT_BOOTSTRAP_KEY = "video_chat_bootstrap_v1";
/** 刷新后恢复聊天区、线程与参数（同 tab sessionStorage）。 */
const VIDEO_CHAT_SNAPSHOT_KEY = "video_chat_snapshot_v1";
const VIDEO_CHAT_SNAPSHOT_VERSION = 2;

/**
 * WebSocket 基础地址（无 query），与后端 `/api/v1/video-tasks/stream` 对应。
 *
 * - **线上**：页面在 `shop-ai.cc` 等正式域时，走同源 `wss://当前域名/...`（经 Nginx → 上游）。
 * - **本地 shopify app dev**（`localhost:*` / `*.localhost`）：默认走 **同源** `ws(s)://当前页面域名/...`，
 *   由 Vite `proxy` 转发到后端。
 *   若必须直连远程 WS（无同源代理），设置 `VITE_VIDEO_TASKS_WS_URL`（整段 wss URL），或使用
 *   `VITE_VIDEO_TASKS_WS_USE_REMOTE=true` + `VITE_VIDEO_TASKS_WS_ORIGIN`。
 *
 * 鉴权方式：WebSocket 无法用 JS 追加 Header，因此统一通过 URL query `?access_token=...` 携带。
 * 调用方需自行把 token 拼到 URL 上（见 `openWebSocket`）。
 */
function getVideoTasksWebSocketBaseUrl() {
  const explicit = import.meta.env?.VITE_VIDEO_TASKS_WS_URL;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim().split(/[?#]/)[0];
  }

  if (typeof window === "undefined") {
    return "";
  }

  const h = window.location.hostname;
  const isLocalDevHost =
    h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost");

  const useRemote =
    String(import.meta.env?.VITE_VIDEO_TASKS_WS_USE_REMOTE || "").trim() ===
    "true";

  if (isLocalDevHost && useRemote) {
    const publicOriginRaw = import.meta.env?.VITE_VIDEO_TASKS_WS_ORIGIN;
    const publicOrigin =
      (typeof publicOriginRaw === "string" && publicOriginRaw.trim()) ||
      "https://shop-ai.cc";
    try {
      const u = new URL(publicOrigin);
      const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
      const port = u.port ? `:${u.port}` : "";
      return `${wsProto}//${u.hostname}${port}/api/v1/video-tasks/stream`;
    } catch {
      return "wss://shop-ai.cc/api/v1/video-tasks/stream";
    }
  }

  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${window.location.host}/api/v1/video-tasks/stream`;
}

/**
 * 固定演示请求：
 * 1) 便于先联调 create 接口，不依赖「视频参数页面」是否完成；
 * 2) 你后续可以直接在这里改 trend / brand / product / media_assets。
 */
const DEMO_CREATE_THREAD_PAYLOAD = {
  trend: {
    title: "The Hunger Games: Sunrise on the Reaping (2026) Official Trailer – Joseph Zada",
    summary:
      "Official trailer for 'The Hunger Games: Sunrise on the Reaping' (2026), a prequel set 24 years before the original trilogy, focusing on the 50th Hunger Games (Second Quarter Quell) and young Coriolanus Snow's rise in Panem. Features Tom Blyth, Rachel Zegler, Viola Davis, and Elle Fanning.",
    tags: [
      "The Hunger Games",
      "hunger games trailer",
      "Tom Blyth",
      "Rachel Zegler",
      "Coriolanus Snow",
      "hunger games prequel",
      "Panem",
    ],
    audience: [
      "16-25岁反乌托邦文学爱好者",
      "YA小说改编电影核心观众",
      "BTS与K-pop联动粉丝（因 Rachel Zegler's BTS collab history）",
      "dystopian world-building enthusiasts",
      "prequel-driven franchise fans",
    ],
  },
  brand: {
    name: "Power Practical",
    core_value: "实用主义与创新技术的结合，致力于提供解决日常问题的便携式电源和照明解决方案",
    mainly_sold_products: "消费电子 / 户外用品 / 汽车配件",
    tone: "现代、功能导向、可靠",
    audience: ["户外探险爱好者", "注重汽车清洁的车主", "露营和旅行者", "追求创新家居用品的消费者"],
  },
  product: {
    product_id: 10401352810805,
    name: "DRIVE - 汽车后备箱收纳袋 - 可折叠,多隔层汽车 SUV 汽车收纳箱,带可调节肩带 - 卡车和汽车配件男女适用 - 灰色",
    description:
      "可折叠 – 有了 Drive Auto 汽车后备箱整理工具，现在可以轻松地整理汽车。它可以调整大小以适应大或小的车辆空间,不使用时方便折叠。容量大，多个隔层可放置杂货、工具、电缆和工作材料，防水衬里与硬底板更耐用。",
    price: 30,
    image_url: "https://cdn.shopify.com/s/files/1/0986/4101/9189/files/1_f809fe26-db8e-46e8-a740-51144d8118b5.jpg?v=1770617886",
    inventory: 200,
    variants: null,
  },
  user_input:
    "In a Hunger Games-like escape scene, people climb a mountain and discover our car trunk organizer full of survival food and tools. Make it absurd, exaggerated and funny. Characters should speak English. End with: Power Practical trunk organizer, must-have for life.",
  generation_mode: "image_to_video",
  media_assets: {
    ref_image_urls: [
      "https://cdn.shopify.com/s/files/1/0986/4101/9189/files/1_f809fe26-db8e-46e8-a740-51144d8118b5.jpg?v=1770617886",
    ],
  },
  config_params: {
    resolution: "720p",
    ratio: "adaptive",
    language: "en",
    watermark: false,
    generate_audio: true,
  },
};

function cloneVideoParams(src) {
  return {
    ...src,
    firstFrameList: src.firstFrameList ? [...src.firstFrameList] : [],
    lastFrameList: src.lastFrameList ? [...src.lastFrameList] : [],
  };
}

function deepCloneJson(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 将 GET /video-thread/{id}/history 根级的 product / product_for_prompt 合并进 create 载荷（供恢复会话与通过分镜提示）。 */
function buildMergedCreatePayloadWithHistory(prevPayload, historyRoot) {
  const product = historyRoot?.product;
  const productForPrompt = historyRoot?.product_for_prompt;
  const hasHistoryProduct =
    (product && typeof product === "object" && Object.keys(product).length > 0) ||
    (productForPrompt && typeof productForPrompt === "object" && Object.keys(productForPrompt).length > 0);
  if (!hasHistoryProduct) {
    return prevPayload;
  }

  const base =
    prevPayload && typeof prevPayload === "object" && Object.keys(prevPayload).length > 0
      ? deepCloneJson(prevPayload)
      : {
          trend: { title: "", summary: "", tags: [], audience: null },
          brand: null,
          product: {
            product_id: 0,
            name: "",
            description: "",
            size_description: "",
            price: 0,
            image_url: "",
            inventory: 0,
            variants: null,
          },
          user_input: "",
          generation_mode: BACKEND_GENERATION_MODE_MULTIMODAL,
          config_params: {
            resolution: "720p",
            ratio: "adaptive",
            language: "zh",
            watermark: false,
            generate_audio: true,
          },
          media_assets: null,
        };

  const mergedProduct = {
    ...(typeof base.product === "object" && base.product ? base.product : {}),
  };
  if (product && typeof product === "object") {
    Object.assign(mergedProduct, product);
  }
  if (productForPrompt && typeof productForPrompt === "object") {
    const sz = productForPrompt.size_description;
    if (typeof sz === "string" && sz.trim() && !String(mergedProduct.size_description || "").trim()) {
      mergedProduct.size_description = sz.trim();
    }
    if (!mergedProduct.name && productForPrompt.name) {
      mergedProduct.name = String(productForPrompt.name);
    }
    if (!mergedProduct.image_url && productForPrompt.image_url) {
      mergedProduct.image_url = String(productForPrompt.image_url);
    }
    if ((mergedProduct.price == null || mergedProduct.price === "") && productForPrompt.price != null) {
      mergedProduct.price = productForPrompt.price;
    }
  }
  base.product = mergedProduct;
  return base;
}

async function loadThreadHistoryPayload(threadId) {
  const res = await authFetch(`${VIDEO_THREAD_API_BASE}/${encodeURIComponent(threadId)}/history`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json?.code != null && Number(json.code) !== 0)) {
    const errText =
      (json && (json.message || json.detail)) || res.statusText || "请求失败";
    return { ok: false, data: null, errText };
  }
  return { ok: true, data: json?.data || {}, errText: null };
}

function hydrateProductReferenceFromHistory(sessionId, historyRoot, setPendingReferenceAssetsBySession) {
  const product = historyRoot?.product;
  const productForPrompt = historyRoot?.product_for_prompt;
  const imgRaw =
    (product && typeof product.image_url === "string" && product.image_url.trim()) ||
    (productForPrompt && typeof productForPrompt.image_url === "string" && productForPrompt.image_url.trim()) ||
    "";
  if (!imgRaw || !/^https?:\/\//i.test(imgRaw)) return;
  const nameRaw =
    (product && typeof product.name === "string" && product.name.trim()) ||
    (productForPrompt && typeof productForPrompt.name === "string" && productForPrompt.name.trim()) ||
    "";
  setPendingReferenceAssetsBySession((prev) => {
    const cur = prev[sessionId] ?? { ...EMPTY_PENDING_REFERENCE_ASSETS };
    if (cur.images.length > 0) return prev;
    const entry = createBootstrapProductImageEntry(imgRaw, nameRaw);
    if (!entry) return prev;
    const next = { ...EMPTY_PENDING_REFERENCE_ASSETS, images: [entry] };
    if (!validateReferenceAggregates(next).ok) return prev;
    return { ...prev, [sessionId]: next };
  });
}

function parseGenerateBootstrap(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.createPayload || typeof raw.createPayload !== "object") return null;
  return raw;
}

function serializePendingReferenceAssets(assets) {
  const { images = [], audios = [], videos = [] } = assets || {};
  return {
    images: images.map((e) => ({
      fileName: e?.file?.name || "",
      mime: e?.file?.type || "",
      dataUrl: e?.dataUrl || null,
      remoteUrl: e?.remoteUrl || null,
      meta: e?.meta && typeof e.meta === "object" ? e.meta : {},
      fromBootstrapProduct: Boolean(e?.fromBootstrapProduct),
    })),
    audios: audios.map((e) => ({
      fileName: e?.file?.name || "",
      mime: e?.file?.type || "",
      dataUrl: e?.dataUrl || null,
      remoteUrl: e?.remoteUrl || null,
      meta: e?.meta && typeof e.meta === "object" ? e.meta : {},
    })),
    videos: videos.map((e) => ({
      fileName: e?.file?.name || "",
      mime: e?.file?.type || "",
      dataUrl: e?.dataUrl || null,
      remoteUrl: e?.remoteUrl || null,
      meta: e?.meta && typeof e.meta === "object" ? e.meta : {},
    })),
  };
}

function deserializePendingReferenceAssets(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_PENDING_REFERENCE_ASSETS };
  }
  const mapImages = Array.isArray(raw.images)
    ? raw.images.map((e) => {
        const fileName =
          typeof e?.fileName === "string" && e.fileName.trim() ? e.fileName.trim() : "file";
        const mime =
          typeof e?.mime === "string" && e.mime.trim() ? e.mime.trim() : "application/octet-stream";
        return {
          file: new File([], fileName, { type: mime }),
          dataUrl: typeof e?.dataUrl === "string" ? e.dataUrl : null,
          remoteUrl: typeof e?.remoteUrl === "string" ? e.remoteUrl : null,
          meta: e?.meta && typeof e.meta === "object" ? e.meta : {},
          fromBootstrapProduct: Boolean(e?.fromBootstrapProduct),
        };
      })
    : [];
  const mapAv = (arr, fallbackMime) =>
    Array.isArray(arr)
      ? arr.map((e) => {
          const fileName =
            typeof e?.fileName === "string" && e.fileName.trim() ? e.fileName.trim() : "file";
          const mime =
            typeof e?.mime === "string" && e.mime.trim() ? e.mime.trim() : fallbackMime;
          return {
            file: new File([], fileName, { type: mime }),
            dataUrl: typeof e?.dataUrl === "string" ? e.dataUrl : null,
            remoteUrl: typeof e?.remoteUrl === "string" ? e.remoteUrl : null,
            meta: e?.meta && typeof e.meta === "object" ? e.meta : {},
          };
        })
      : [];
  return {
    images: mapImages,
    audios: mapAv(raw.audios, "audio/*"),
    videos: mapAv(raw.videos, "video/*"),
  };
}

async function validateReferenceFile(file, bucket) {
  const blobUrl = URL.createObjectURL(file);
  try {
    if (bucket === "images") {
      const r = await validateImageFile(file, blobUrl);
      if (!r.ok) return { ok: false, errors: r.errors };
      return { ok: true, errors: [], meta: r.meta };
    }
    if (bucket === "videos") {
      const r = await validateVideoFile(file, blobUrl);
      if (!r.ok) return { ok: false, errors: r.errors };
      return { ok: true, errors: [], meta: r.meta };
    }
    if (bucket === "audios") {
      const r = await validateAudioFile(file, blobUrl);
      if (!r.ok) return { ok: false, errors: r.errors };
      return { ok: true, errors: [], meta: r.meta };
    }
    return { ok: false, errors: ["未知素材类型"] };
  } finally {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore
    }
  }
}

function extractUploadFileUrl(json) {
  const url = json?.data?.url || json?.url;
  return typeof url === "string" && url.trim() ? url.trim() : "";
}

async function uploadReferenceFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await authFetch(UPLOAD_FILE_API, {
    method: "POST",
    body: formData,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.data?.message || json?.message || `上传失败: ${res.status}`;
    throw new Error(detail);
  }
  if (json?.code != null && Number(json.code) !== 0) {
    throw new Error(json?.message || "上传失败");
  }

  const url = extractUploadFileUrl(json);
  if (!url) {
    throw new Error("上传失败：接口未返回文件 URL");
  }
  return {
    url,
    key: typeof json?.data?.key === "string" ? json.data.key : "",
  };
}

function readVideoChatSnapshotPayload() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(VIDEO_CHAT_SNAPSHOT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || (Number(data.v) !== 1 && Number(data.v) !== 2)) return null;
    if (!Array.isArray(data.sessions) || data.sessions.length === 0) return null;
    if (typeof data.activeSessionId !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

function buildDemoInitialState() {
  const id = `s-${uid()}`;
  const t = Date.now();
  const defaultVp = cloneVideoParams(DEFAULT_VIDEO_PARAMS);
  return {
    sessions: [{ id, title: "新对话", updatedAt: t }],
    activeSessionId: id,
    messagesBySession: {
      [id]: [{ id: uid(), role: "assistant", content: WELCOME_TEXT, suggestions: true }],
    },
    draft: "",
    pendingReferenceAssetsBySession: { [id]: { ...EMPTY_PENDING_REFERENCE_ASSETS } },
    createPayloadBySession: {},
    videoParamsBySession: { [id]: cloneVideoParams(defaultVp) },
    paramDraftBySession: { [id]: cloneVideoParams(defaultVp) },
    threadBySession: {},
    threadViewBySession: {},
    threadRequestingBySession: {},
    generationStatusById: {},
    generationToSegmentBySession: {},
    segmentCacheBySession: {},
    segmentDraftBySession: {},
    segmentDurationDraftBySession: {},
    segmentSubmittingBySession: {},
    /** 会话内各分镜是否处于「单条字段编辑」态（不落快照，刷新即清） */
    segmentFieldEditBySession: {},
    /** 会话内是否处于「一次性编辑全部分镜」态 */
    segmentBulkFieldEditBySession: {},
  };
}

function hydrateFromSnapshotPayload(data) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const activeSessionId =
    typeof data.activeSessionId === "string" && data.activeSessionId
      ? data.activeSessionId
      : sessions[0]?.id || "";
  const paramSrc =
    data.paramDraft && typeof data.paramDraft === "object" ? data.paramDraft : data.videoParams;

  let pendingReferenceAssetsBySession = {};
  if (data.pendingReferenceAssetsBySession && typeof data.pendingReferenceAssetsBySession === "object") {
    for (const [k, v] of Object.entries(data.pendingReferenceAssetsBySession)) {
      pendingReferenceAssetsBySession[k] = deserializePendingReferenceAssets(v);
    }
  } else if (data.pendingReferenceAssets != null) {
    pendingReferenceAssetsBySession[activeSessionId] = deserializePendingReferenceAssets(
      data.pendingReferenceAssets,
    );
  }

  let videoParamsBySession = {};
  if (data.videoParamsBySession && typeof data.videoParamsBySession === "object") {
    for (const [k, v] of Object.entries(data.videoParamsBySession)) {
      videoParamsBySession[k] = cloneVideoParams({ ...DEFAULT_VIDEO_PARAMS, ...(v || {}) });
    }
  } else {
    videoParamsBySession[activeSessionId] = cloneVideoParams({
      ...DEFAULT_VIDEO_PARAMS,
      ...(data.videoParams || {}),
    });
  }

  let paramDraftBySession = {};
  if (data.paramDraftBySession && typeof data.paramDraftBySession === "object") {
    for (const [k, v] of Object.entries(data.paramDraftBySession)) {
      paramDraftBySession[k] = cloneVideoParams({ ...DEFAULT_VIDEO_PARAMS, ...(v || {}) });
    }
  } else {
    paramDraftBySession[activeSessionId] = cloneVideoParams({
      ...DEFAULT_VIDEO_PARAMS,
      ...(paramSrc || {}),
    });
  }

  const messagesBySession =
    data.messagesBySession && typeof data.messagesBySession === "object" ? data.messagesBySession : {};
  const allSessionIds = new Set([
    ...sessions.map((s) => s?.id).filter((id) => typeof id === "string"),
    ...Object.keys(messagesBySession),
    ...Object.keys(pendingReferenceAssetsBySession),
    ...Object.keys(videoParamsBySession),
    ...Object.keys(paramDraftBySession),
  ]);
  for (const id of allSessionIds) {
    if (!pendingReferenceAssetsBySession[id]) {
      pendingReferenceAssetsBySession[id] = { ...EMPTY_PENDING_REFERENCE_ASSETS };
    }
    if (!videoParamsBySession[id]) {
      videoParamsBySession[id] = cloneVideoParams(DEFAULT_VIDEO_PARAMS);
    }
    if (!paramDraftBySession[id]) {
      paramDraftBySession[id] = cloneVideoParams(videoParamsBySession[id]);
    }
  }

  return {
    sessions,
    activeSessionId,
    messagesBySession,
    draft: typeof data.draft === "string" ? data.draft : "",
    pendingReferenceAssetsBySession,
    createPayloadBySession:
      data.createPayloadBySession && typeof data.createPayloadBySession === "object"
        ? data.createPayloadBySession
        : {},
    videoParamsBySession,
    paramDraftBySession,
    threadBySession:
      data.threadBySession && typeof data.threadBySession === "object" ? data.threadBySession : {},
    threadViewBySession:
      data.threadViewBySession && typeof data.threadViewBySession === "object"
        ? data.threadViewBySession
        : {},
    threadRequestingBySession: {},
    generationStatusById:
      data.generationStatusById && typeof data.generationStatusById === "object"
        ? data.generationStatusById
        : {},
    generationToSegmentBySession:
      data.generationToSegmentBySession && typeof data.generationToSegmentBySession === "object"
        ? data.generationToSegmentBySession
        : {},
    segmentCacheBySession:
      data.segmentCacheBySession && typeof data.segmentCacheBySession === "object"
        ? data.segmentCacheBySession
        : {},
    segmentDraftBySession:
      data.segmentDraftBySession && typeof data.segmentDraftBySession === "object"
        ? data.segmentDraftBySession
        : {},
    segmentDurationDraftBySession:
      data.segmentDurationDraftBySession && typeof data.segmentDurationDraftBySession === "object"
        ? data.segmentDurationDraftBySession
        : {},
    segmentSubmittingBySession: {},
    segmentFieldEditBySession: {},
    segmentBulkFieldEditBySession: {},
  };
}

function getVideoChatInitialStateForMount() {
  const raw = readVideoChatSnapshotPayload();
  if (raw) {
    return { hadSnapshot: true, ...hydrateFromSnapshotPayload(raw) };
  }
  return { hadSnapshot: false, ...buildDemoInitialState() };
}

const BOOTSTRAP_FOLLOW_UP_PROMPT =
  "您对于视频生成有什么想法？（视频剧情、视频氛围、上传参考图）";

/** 纯文本备份（复制、无障碍说明） */
function buildBootstrapPlainCopyText(createPayload) {
  const trend = createPayload?.trend;
  const product = createPayload?.product;
  const lines = ["您当前从生成页带入的上下文："];

  const title = typeof trend?.title === "string" ? trend.title.trim() : "";
  const summaryRaw = typeof trend?.summary === "string" ? trend.summary.trim() : "";
  const summary = summaryRaw && summaryRaw !== title ? summaryRaw : "";
  const tags =
    Array.isArray(trend?.tags) ? trend.tags.filter(Boolean).slice(0, 12).map(String) : [];
  const marketingRaw =
    typeof trend?.marketing_suggestion === "string" ? trend.marketing_suggestion.trim() : "";

  if (title || summary || tags.length) {
    lines.push("");
    lines.push("[热点]");
    if (title) lines.push(title);
    if (summary) lines.push(summary);
    if (tags.length) lines.push(`标签：${tags.join("、")}`);
  } else {
    lines.push("", "[热点]", "（暂无）");
  }

  const pName = typeof product?.name === "string" ? product.name.trim() : "";
  const pPrice =
    product?.price != null && product.price !== "" ? String(product.price) : "";
  if (pName || pPrice) {
    lines.push("");
    lines.push("[推广产品]");
    if (pName) lines.push(pName);
    if (pPrice) lines.push(`价格：${pPrice}`);
  } else {
    lines.push("", "[推广产品]", "（暂无）");
  }

  if (marketingRaw) {
    lines.push("");
    lines.push("[营销建议]");
    lines.push(marketingRaw);
  }

  return lines.filter((l, i) => !(l === "" && i === lines.length - 1)).join("\n");
}

/* eslint-disable react/prop-types */
function VideoChatBootstrapContextCard({ context }) {
  const trend = context?.trend;
  const product = context?.product;

  const title = typeof trend?.title === "string" ? trend.title.trim() : "";
  const summaryRaw = typeof trend?.summary === "string" ? trend.summary.trim() : "";
  const showSummary =
    Boolean(summaryRaw) && summaryRaw !== title;
  const tags =
    Array.isArray(trend?.tags) ? trend.tags.filter(Boolean).slice(0, 12).map(String) : [];
  const marketingText =
    typeof trend?.marketing_suggestion === "string" ? trend.marketing_suggestion.trim() : "";

  const pName = typeof product?.name === "string" ? product.name.trim() : "";
  const img =
    typeof product?.image_url === "string"
      ? product.image_url.trim()
      : "";
  let priceNum = "";
  if (product?.price != null && product.price !== "") {
    priceNum = String(product.price).trim();
  }

  const hasHotspotBlock = Boolean(title || showSummary || tags.length > 0);
  const hasProductBlock = Boolean(pName || img || priceNum);
  const hasMarketingBlock = Boolean(marketingText);

  return (
    <div className="video-chat-bootstrap" role="article" aria-label="来自生成页的上下文预览">
      <div className="video-chat-bootstrap__intro">已从生成页为你带入以下内容，可直接在下方说说你的视频想法～</div>

      {hasHotspotBlock && (
        <section className="video-chat-bootstrap__section" aria-label="热点">
          <div className="video-chat-bootstrap__section-label">热点</div>
          {title ? <h3 className="video-chat-bootstrap__hotspot-title">{title}</h3> : null}
          {showSummary ? (
            <p className="video-chat-bootstrap__hotspot-summary">{summaryRaw}</p>
          ) : null}
          {tags.length > 0 ? (
            <ul className="video-chat-bootstrap__tags" aria-label="标签">
              {tags.map((t) => (
                <li key={t} className="video-chat-bootstrap__tag">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      {hasProductBlock && (
        <section className="video-chat-bootstrap__section" aria-label="推广产品">
          <div className="video-chat-bootstrap__section-label">推广产品</div>
          <div className="video-chat-bootstrap__product">
            {img ? (
              <div className="video-chat-bootstrap__product-thumb">
                <img src={img} alt="" loading="lazy" decoding="async" />
              </div>
            ) : (
              <div className="video-chat-bootstrap__product-thumb video-chat-bootstrap__product-thumb--empty" aria-hidden />
            )}
            <div className="video-chat-bootstrap__product-body">
              {pName ? (
                <div className="video-chat-bootstrap__product-name">{pName}</div>
              ) : (
                <div className="video-chat-bootstrap__product-name video-chat-bootstrap__muted">（未命名商品）</div>
              )}
              {priceNum ? (
                <div className="video-chat-bootstrap__product-price">
                  <span className="video-chat-bootstrap__price-value">¥{priceNum}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {hasMarketingBlock && (
        <section className="video-chat-bootstrap__section" aria-label="营销建议">
          <div className="video-chat-bootstrap__section-label">营销建议</div>
          <p className="video-chat-bootstrap__marketing-text">{marketingText}</p>
        </section>
      )}

      {!hasHotspotBlock && !hasProductBlock && !hasMarketingBlock ? (
        <p className="video-chat-bootstrap__muted">暂无可展示的上下文，可在下方直接描述你的视频需求。</p>
      ) : null}
    </div>
  );
}
/* eslint-enable react/prop-types */

/** 根据生成页传入的 createPayload 生成欢迎后的两条助手消息（热点卡片 + 产品卡片 + 引导提问） */
function buildBootstrapContextAssistantMessages(createPayload) {
  const copyText = buildBootstrapPlainCopyText(createPayload);
  const trend = createPayload?.trend;
  const product = createPayload?.product;

  return [
    {
      id: uid(),
      role: "assistant",
      content: copyText,
      copyText,
      bootstrapContext: { trend, product },
    },
    { id: uid(), role: "assistant", content: BOOTSTRAP_FOLLOW_UP_PROMPT },
  ];
}

/** 线程视图 / progress SSE → 聊天区多行文案（与后端 FrontendViewState、progress 事件对齐） */
function formatThreadViewProgressBody(view) {
  if (!view || typeof view !== "object") return "";
  const lines = [];
  const msg = typeof view.message === "string" ? view.message.trim() : "";
  if (msg) lines.push(msg);
  const meta = [];
  if (typeof view.progress === "number") meta.push(`进度 ${view.progress}%`);
  const step = view.current_step ?? view.step;
  if (step) meta.push(`步骤 ${step}`);
  if (view.status) meta.push(`状态 ${view.status}`);
  if (meta.length) lines.push(meta.join(" · "));
  return lines.join("\n");
}

function shouldSkipThreadProgressBubbleForView(view) {
  if (!view || typeof view !== "object") return true;
  const segs = view.segments;
  if (
    view.status === "waiting_human" &&
    view.review_phase !== "video" &&
    Array.isArray(segs) &&
    segs.length > 0
  ) {
    return true;
  }
  return !formatThreadViewProgressBody(view).trim();
}

function fingerprintThreadProgress(threadId, view) {
  const step = view?.current_step ?? view?.step ?? "";
  return `${threadId}|${view?.status ?? ""}|${view?.message ?? ""}|${view?.progress ?? ""}|${step}`;
}

/** WebSocket generation_status 载荷 → 多行文案（兼容后端未来扩展字段） */
function formatGenerationStatusChatBody(payload) {
  const generationId = payload?.generation_id;
  const status = payload?.status || "unknown";
  const lines = [];
  lines.push(`任务 #${generationId ?? "-"}：${status}`);
  const msg = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (msg) lines.push(msg);
  const meta = [];
  if (typeof payload?.progress === "number") meta.push(`进度 ${payload.progress}%`);
  const step = payload?.current_step ?? payload?.step;
  if (step) meta.push(`步骤 ${step}`);
  if (meta.length) lines.push(meta.join(" · "));
  if (status === "succeeded" && payload?.video_url) lines.push(`视频地址：${payload.video_url}`);
  if (status === "failed" && payload?.error_message) lines.push(`原因：${payload.error_message}`);
  return lines.join("\n");
}

const SEGMENT_TASK_STATUS_LABEL = {
  queued: "排队中",
  submitted: "已提交",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
};

function getSegmentStatusMeta(viewStatus, taskStatus) {
  if (taskStatus === "failed") return { text: SEGMENT_TASK_STATUS_LABEL.failed, tone: "danger" };
  if (taskStatus === "succeeded") return { text: SEGMENT_TASK_STATUS_LABEL.succeeded, tone: "success" };
  if (taskStatus === "running") return { text: SEGMENT_TASK_STATUS_LABEL.running, tone: "processing" };
  if (taskStatus === "queued" || taskStatus === "submitted") {
    return { text: SEGMENT_TASK_STATUS_LABEL[taskStatus], tone: "pending" };
  }
  if (viewStatus === "waiting_human") return { text: "待你确认", tone: "draft" };
  if (viewStatus === "running") return { text: "处理中", tone: "processing" };
  if (viewStatus === "finished") return { text: "已提交", tone: "pending" };
  if (viewStatus === "error") return { text: "异常", tone: "danger" };
  return { text: "未开始", tone: "draft" };
}

function getSegmentDescriptionText(segment) {
  return (
    (typeof segment?.description === "string" && segment.description.trim()) ||
    (typeof segment?.description_en === "string" && segment.description_en.trim()) ||
    ""
  );
}

/** 分镜时长：-1 为模型自主选择；可选 4–15s */
const SEGMENT_DURATION_AUTONOMOUS = -1;
const SEGMENT_DURATION_SECONDS = Array.from({ length: 12 }, (_, i) => i + 4);

function coerceSegmentDurationFromBackend(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return SEGMENT_DURATION_AUTONOMOUS;
  if (n === -1) return SEGMENT_DURATION_AUTONOMOUS;
  if (n >= 4 && n <= 15) return n;
  if (n > 0) return Math.min(15, Math.max(4, Math.round(n)));
  return SEGMENT_DURATION_AUTONOMOUS;
}

function isAllowedSegmentDuration(d) {
  if (d === SEGMENT_DURATION_AUTONOMOUS) return true;
  const n = Number(d);
  return Number.isFinite(n) && n >= 4 && n <= 15;
}

function resolveSegmentDurationDraft(sid, draftMap, segment) {
  const raw = draftMap[sid];
  if (raw !== undefined && raw !== null) return raw;
  return coerceSegmentDurationFromBackend(segment?.duration);
}

/** 侧栏「历史对话」中与 GET /video-thread/list 对应的会话 id 前缀 */
const SERVER_THREAD_SESSION_PREFIX = "srv-";

function threadIdFromServerSessionId(sessionId) {
  if (typeof sessionId !== "string" || !sessionId.startsWith(SERVER_THREAD_SESSION_PREFIX)) {
    return "";
  }
  return sessionId.slice(SERVER_THREAD_SESSION_PREFIX.length);
}

/** 与聊天区分镜气泡去重逻辑一致（见 tryAppendSegmentsChat） */
function buildSegmentDraftFingerprint(threadId, segments) {
  if (!threadId || !Array.isArray(segments) || segments.length === 0) return "";
  const sorted = [...segments].sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0));
  return `${threadId}|${sorted
    .map(
      (s) =>
        `${s?.segment_id}:${s?.duration ?? ""}:${s?.mode ?? ""}:${String(s?.description || s?.description_en || "").slice(0, 48)}`,
    )
    .join("¦")}`;
}

/** GET /video-thread/{id}/history → 聊天消息列表 + 最后一版分镜指纹（用于与 /state、SSE 去重） */
function buildMessagesFromThreadHistoryPayload(threadId, payload) {
  const turns = Array.isArray(payload?.turns) ? payload.turns : [];
  const messages = [];
  let lastSegmentDraftFingerprint = "";

  for (const turn of turns) {
    const kind = turn?.kind;
    if (kind === "user_input") {
      const text = (turn.user_input && String(turn.user_input).trim()) || "（无文字）";
      messages.push({ id: uid(), role: "user", content: text });
    } else if (kind === "assistant_draft") {
      const segs = Array.isArray(turn.segments) ? turn.segments : [];
      const fp = buildSegmentDraftFingerprint(threadId, segs);
      if (fp) lastSegmentDraftFingerprint = fp;

      const sorted = [...segs].sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0));
      const draftListItems = sorted.map((s) => {
        const sid = Number(s?.segment_id);
        const description = getSegmentDescriptionText(s);
        const durRaw = s?.duration;
        const durationLabel = durRaw != null && durRaw !== "" ? `${durRaw}s` : "";
        return {
          segmentId: Number.isFinite(sid) ? sid : null,
          description,
          durationLabel,
        };
      });

      const metaParts = [];
      if (turn.total_duration != null) metaParts.push(`总时长约 ${turn.total_duration}s`);
      if (turn.execution_strategy) metaParts.push(String(turn.execution_strategy));
      const durationSummary = metaParts.length ? metaParts.join(" · ") : null;

      const linesPlain = ["【分镜草稿】"];
      if (turn.revision_count != null) linesPlain.push(`修订轮次：${turn.revision_count}`);
      if (turn.created_at) linesPlain.push(`时间：${turn.created_at}`);
      if (durationSummary) linesPlain.push(durationSummary);
      if (draftListItems.length) {
        draftListItems.forEach((it, idx) => {
          const n = it.segmentId != null ? it.segmentId : idx + 1;
          linesPlain.push(`${n}. ${it.description}${it.durationLabel ? `（${it.durationLabel}）` : ""}`);
        });
      } else {
        linesPlain.push("（无分镜条目）");
      }
      const plain = linesPlain.join("\n");

      messages.push({
        id: uid(),
        role: "assistant",
        content: plain,
        copyText: plain,
        historySegmentDraft: {
          revisionCount: turn.revision_count != null ? turn.revision_count : null,
          createdAt: turn.created_at != null ? String(turn.created_at) : null,
          durationSummary,
          items: draftListItems,
          emptySegments: draftListItems.length === 0,
        },
      });
    } else if (kind === "user_action") {
      const action = turn.action || "unknown";
      const parts = [`【你的操作】${action}`];
      if (turn.human_feedback && String(turn.human_feedback).trim()) {
        parts.push(`反馈：${String(turn.human_feedback).trim()}`);
      }
      const edited = Array.isArray(turn.human_edited_segments) ? turn.human_edited_segments : [];
      if (edited.length) {
        parts.push("编辑分镜：");
        const sorted = [...edited].sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0));
        for (const s of sorted) {
          const sid = Number(s?.segment_id);
          parts.push(`  · ${Number.isFinite(sid) ? sid : "?"}：${getSegmentDescriptionText(s)}`);
        }
      }
      messages.push({ id: uid(), role: "user", content: parts.join("\n") });
    } else if (kind === "submitted") {
      messages.push({
        id: uid(),
        role: "assistant",
        content: "【系统】已向视频引擎提交生成任务。",
      });
    }
  }

  const urls = Array.isArray(payload?.final_video_urls) ? payload.final_video_urls.filter(Boolean) : [];
  if (urls.length) {
    messages.push({
      id: uid(),
      role: "assistant",
      content: `【成片链接】\n${urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`,
    });
  }

  if (!messages.length) {
    messages.push({
      id: uid(),
      role: "assistant",
      content: "（该会话暂无历史记录）",
    });
  }

  return { messages, lastSegmentDraftFingerprint };
}

/** 将服务端列表合并进本地 sessions：已绑定 thread 的本地会话不重复插入 */
function mergeVideoThreadListIntoSessions(serverItems, prevSessions, threadBySessionMap) {
  const usedThreadIds = new Set(
    Object.values(threadBySessionMap || {}).filter((t) => typeof t === "string" && t.length > 0),
  );
  const itemByTid = new Map(
    (Array.isArray(serverItems) ? serverItems : [])
      .filter((it) => it && typeof it.thread_id === "string")
      .map((it) => [it.thread_id, it]),
  );

  const next = prevSessions.map((s) => {
    const tid = threadIdFromServerSessionId(s.id);
    if (!tid) return s;
    const it = itemByTid.get(tid);
    if (!it) return s;
    const titleRaw = it.title != null ? String(it.title).trim() : "";
    const ts = it.updated_at ? Date.parse(it.updated_at) : NaN;
    return {
      ...s,
      title: titleRaw || s.title,
      updatedAt: Number.isFinite(ts) ? ts : s.updatedAt,
      serverStatus: it.status,
    };
  });

  const existingSrvIds = new Set(
    next.filter((s) => threadIdFromServerSessionId(s.id)).map((s) => s.id),
  );

  for (const [tid, it] of itemByTid) {
    if (usedThreadIds.has(tid)) continue;
    const sid = `${SERVER_THREAD_SESSION_PREFIX}${tid}`;
    if (existingSrvIds.has(sid)) continue;
    const titleRaw = it.title != null ? String(it.title).trim() : "";
    const ts = it.updated_at ? Date.parse(it.updated_at) : NaN;
    next.push({
      id: sid,
      title: titleRaw || `视频任务 ${tid.slice(0, 8)}…`,
      updatedAt: Number.isFinite(ts) ? ts : Date.now(),
      serverStatus: it.status,
    });
    existingSrvIds.add(sid);
  }

  return next;
}

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch {
    // 允许降级渲染
  }
  return null;
};

export default function VideoChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const vcInitRef = useRef(null);
  if (vcInitRef.current === null) {
    vcInitRef.current = getVideoChatInitialStateForMount();
  }
  const vcInit = vcInitRef.current;
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sessions, setSessions] = useState(() => vcInit.sessions);
  const [activeSessionId, setActiveSessionId] = useState(() => vcInit.activeSessionId);
  const [messagesBySession, setMessagesBySession] = useState(() => vcInit.messagesBySession);
  const [draft, setDraft] = useState(() => vcInit.draft);
  const [pendingReferenceAssetsBySession, setPendingReferenceAssetsBySession] = useState(
    () => vcInit.pendingReferenceAssetsBySession,
  );
  const [createPayloadBySession, setCreatePayloadBySession] = useState(() => vcInit.createPayloadBySession);
  const [sending, setSending] = useState(false);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [videoParamsBySession, setVideoParamsBySession] = useState(() => vcInit.videoParamsBySession);
  const [paramModalOpen, setParamModalOpen] = useState(false);
  const [referenceRulesModalOpen, setReferenceRulesModalOpen] = useState(false);
  const [paramDraftBySession, setParamDraftBySession] = useState(() => vcInit.paramDraftBySession);

  const videoParams = useMemo(
    () => videoParamsBySession[activeSessionId] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS),
    [videoParamsBySession, activeSessionId],
  );
  const pendingReferenceAssets = useMemo(
    () => pendingReferenceAssetsBySession[activeSessionId] ?? { ...EMPTY_PENDING_REFERENCE_ASSETS },
    [pendingReferenceAssetsBySession, activeSessionId],
  );
  const paramDraft = useMemo(
    () => paramDraftBySession[activeSessionId] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS),
    [paramDraftBySession, activeSessionId],
  );

  const [threadBySession, setThreadBySession] = useState(() => vcInit.threadBySession);
  const [threadViewBySession, setThreadViewBySession] = useState(() => vcInit.threadViewBySession);
  const [threadRequestingBySession, setThreadRequestingBySession] = useState(
    () => vcInit.threadRequestingBySession,
  );
  const [generationStatusById, setGenerationStatusById] = useState(() => vcInit.generationStatusById);
  const [generationToSegmentBySession, setGenerationToSegmentBySession] = useState(
    () => vcInit.generationToSegmentBySession,
  );
  const [segmentCacheBySession, setSegmentCacheBySession] = useState(() => vcInit.segmentCacheBySession);
  const [segmentDraftBySession, setSegmentDraftBySession] = useState(() => vcInit.segmentDraftBySession);
  const [segmentDurationDraftBySession, setSegmentDurationDraftBySession] = useState(
    () => vcInit.segmentDurationDraftBySession,
  );
  const [segmentSubmittingBySession, setSegmentSubmittingBySession] = useState(
    () => vcInit.segmentSubmittingBySession,
  );
  const [segmentFieldEditBySession, setSegmentFieldEditBySession] = useState(
    () => vcInit.segmentFieldEditBySession || {},
  );
  const [segmentBulkFieldEditBySession, setSegmentBulkFieldEditBySession] = useState(
    () => vcInit.segmentBulkFieldEditBySession || {},
  );
  const [videoTailRegenerateSelectionBySession, setVideoTailRegenerateSelectionBySession] = useState({});
  const [historyListLoading, setHistoryListLoading] = useState(false);
  const scrollRef = useRef(null);
  const refFileInputRef = useRef(null);
  const wsRef = useRef(null);
  const wsOpenedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  const threadStreamRef = useRef({});
  const threadBySessionRef = useRef(threadBySession);

  const historyItems = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );
  const sidebarUserName = currentUser?.name || currentUser?.email || "商户";
  const sidebarUserInitial = sidebarUserName.trim().charAt(0) || "商";

  const openParamModal = () => {
    const sid = activeSessionId;
    setParamDraftBySession((prev) => ({
      ...prev,
      [sid]: cloneVideoParams({
        ...(videoParamsBySession[sid] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS)),
        generationMode: "multimodal_reference",
      }),
    }));
    setParamModalOpen(true);
  };

  const saveVideoParams = () => {
    const sid = activeSessionId;
    setVideoParamsBySession((prev) => ({
      ...prev,
      [sid]: cloneVideoParams({
        ...(paramDraftBySession[sid] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS)),
        generationMode: "multimodal_reference",
      }),
    }));
    setParamModalOpen(false);
    antMessage.success("视频参数已保存");
  };

  const paramSummary = `${videoParams.resolution} · ${videoParams.ratio} · 多模态`;

  const pendingReferenceSummary = useMemo(() => {
    const { images, audios, videos } = getUserReferenceAssets(pendingReferenceAssets);
    const parts = [];
    if (images.length) parts.push(`${images.length} 张图`);
    if (audios.length) parts.push(`${audios.length} 段音频`);
    if (videos.length) parts.push(`${videos.length} 段视频`);
    return parts.join("，");
  }, [pendingReferenceAssets]);

  /** 推广商品图 chip 仅用于展示，不作为参考素材上传。 */
  const removePendingReferenceSlot = useCallback(
    (bucket, index) => {
      const sid = activeSessionId;
      setPendingReferenceAssetsBySession((prev) => {
        const cur = prev[sid] ?? { ...EMPTY_PENDING_REFERENCE_ASSETS };
        if (bucket === "images") {
          if (cur.images[index]?.fromBootstrapProduct) return prev;
          return {
            ...prev,
            [sid]: { ...cur, images: cur.images.filter((_, i) => i !== index) },
          };
        }
        if (bucket === "audios") {
          return {
            ...prev,
            [sid]: { ...cur, audios: cur.audios.filter((_, i) => i !== index) },
          };
        }
        if (bucket === "videos") {
          return {
            ...prev,
            [sid]: { ...cur, videos: cur.videos.filter((_, i) => i !== index) },
          };
        }
        return prev;
      });
    },
    [activeSessionId],
  );

  /** 已选参考文件的 chip（首图为推广商品图，与上方气泡同源） */
  const referenceAttachmentChipItems = useMemo(() => {
    const items = [];
    pendingReferenceAssets.images.forEach((entry, index) => {
      const isProductSlot = Boolean(entry?.fromBootstrapProduct);
      items.push({
        key: `ref-image-${index}`,
        bucket: "images",
        index,
        label: formatReferenceAssetChipLabel(entry?.file?.name ?? "image"),
        isProductSlot,
        removable: !isProductSlot,
      });
    });
    pendingReferenceAssets.audios.forEach((entry, index) => {
      items.push({
        key: `ref-audio-${index}`,
        bucket: "audios",
        index,
        label: formatReferenceAssetChipLabel(entry?.file?.name ?? "audio"),
        isProductSlot: false,
        removable: true,
      });
    });
    pendingReferenceAssets.videos.forEach((entry, index) => {
      items.push({
        key: `ref-video-${index}`,
        bucket: "videos",
        index,
        label: formatReferenceAssetChipLabel(entry?.file?.name ?? "video"),
        isProductSlot: false,
        removable: true,
      });
    });
    return items;
  }, [pendingReferenceAssets]);

  const messages = messagesBySession[activeSessionId] ?? EMPTY_MESSAGES;
  const activeThreadId = threadBySession[activeSessionId] || "";
  const activeThreadView = threadViewBySession[activeSessionId] || null;
  const activeWaitingHuman = activeThreadView?.status === "waiting_human";
  const activeVideoReview =
    activeWaitingHuman &&
    (activeThreadView?.review_phase === "video" || activeThreadView?.current_step === "waiting_human_vd");
  const activeScriptReview = activeWaitingHuman && !activeVideoReview;
  const activeThreadRequesting = Boolean(threadRequestingBySession[activeSessionId]);
  const liveSegments = useMemo(
    () => (Array.isArray(activeThreadView?.segments) ? activeThreadView.segments : []),
    [activeThreadView?.segments],
  );
  const activeSegments = useMemo(
    () => segmentCacheBySession[activeSessionId] || liveSegments,
    [activeSessionId, liveSegments, segmentCacheBySession],
  );
  const activeSegmentDraftMap = useMemo(
    () => segmentDraftBySession[activeSessionId] || {},
    [activeSessionId, segmentDraftBySession],
  );
  const activeSegmentDurationDraftMap = useMemo(
    () => segmentDurationDraftBySession[activeSessionId] || {},
    [activeSessionId, segmentDurationDraftBySession],
  );
  const segmentBulkDirtyStats = useMemo(() => {
    if (!activeSegments.length) return { modifiedCount: 0, totalCount: 0 };
    let modified = 0;
    for (const seg of activeSegments) {
      const sid = Number(seg?.segment_id);
      if (!Number.isFinite(sid)) continue;
      const originalText = getSegmentDescriptionText(seg);
      const draftText = String(activeSegmentDraftMap[sid] ?? originalText).trim();
      const draftDuration = resolveSegmentDurationDraft(sid, activeSegmentDurationDraftMap, seg);
      const originalDuration = coerceSegmentDurationFromBackend(seg?.duration);
      if (draftText !== originalText || draftDuration !== originalDuration) modified += 1;
    }
    return { modifiedCount: modified, totalCount: activeSegments.length };
  }, [activeSegmentDraftMap, activeSegmentDurationDraftMap, activeSegments]);

  const activeSegmentSubmittingMap = segmentSubmittingBySession[activeSessionId] || {};
  const activeSegmentFieldEditMap = segmentFieldEditBySession[activeSessionId] || {};
  const activeSegmentBulkFieldEdit = Boolean(segmentBulkFieldEditBySession[activeSessionId]);
  const activeGenerationToSegmentMap = useMemo(
    () => generationToSegmentBySession[activeSessionId] || {},
    [activeSessionId, generationToSegmentBySession],
  );
  const activeTaskStatusMap = useMemo(() => {
    const map = {};
    const taskResults = activeThreadView?.task_results;
    if (Array.isArray(taskResults)) {
      taskResults.forEach((item) => {
        const sid = Number(item?.segment_id);
        if (!Number.isFinite(sid)) return;
        const gid = Number(item?.generation_id);
        const runtimeStatus = Number.isFinite(gid) ? generationStatusById[gid]?.status : "";
        map[sid] = runtimeStatus || item?.status || "";
      });
    }
    Object.entries(activeGenerationToSegmentMap).forEach(([gidRaw, sidRaw]) => {
      const gid = Number(gidRaw);
      const sid = Number(sidRaw);
      if (!Number.isFinite(gid) || !Number.isFinite(sid)) return;
      const runtimeStatus = generationStatusById[gid]?.status;
      if (runtimeStatus) map[sid] = runtimeStatus;
    });
    return map;
  }, [activeGenerationToSegmentMap, activeThreadView?.task_results, generationStatusById]);
  const activeSegmentVideoUrlMap = useMemo(() => {
    const map = {};
    const taskResults = activeThreadView?.task_results;
    if (Array.isArray(taskResults)) {
      taskResults.forEach((item) => {
        const sid = Number(item?.segment_id);
        const gid = Number(item?.generation_id);
        if (!Number.isFinite(sid)) return;
        const url = (Number.isFinite(gid) ? generationStatusById[gid]?.video_url : "") || item?.video_url;
        if (url) map[sid] = url;
      });
    }
    Object.entries(activeGenerationToSegmentMap).forEach(([gidRaw, sidRaw]) => {
      const gid = Number(gidRaw);
      const sid = Number(sidRaw);
      if (!Number.isFinite(gid) || !Number.isFinite(sid)) return;
      const url = generationStatusById[gid]?.video_url;
      if (url) map[sid] = url;
    });
    return map;
  }, [activeGenerationToSegmentMap, activeThreadView?.task_results, generationStatusById]);
  const activeSegmentErrorMap = useMemo(() => {
    const map = {};
    const taskResults = activeThreadView?.task_results;
    if (Array.isArray(taskResults)) {
      taskResults.forEach((item) => {
        const sid = Number(item?.segment_id);
        const gid = Number(item?.generation_id);
        if (!Number.isFinite(sid)) return;
        const fromTask = (item?.error_message || "").trim();
        const fromWs = Number.isFinite(gid) ? (generationStatusById[gid]?.error_message || "").trim() : "";
        const msg = fromWs || fromTask;
        if (msg) map[sid] = msg;
      });
    }
    Object.entries(activeGenerationToSegmentMap).forEach(([gidRaw, sidRaw]) => {
      const gid = Number(gidRaw);
      const sid = Number(sidRaw);
      if (!Number.isFinite(gid) || !Number.isFinite(sid)) return;
      const fromWs = (generationStatusById[gid]?.error_message || "").trim();
      if (fromWs) map[sid] = fromWs;
    });
    return map;
  }, [activeGenerationToSegmentMap, activeThreadView?.task_results, generationStatusById]);
  const activeVideoResultMap = useMemo(() => {
    const map = {};
    const rows = Array.isArray(activeThreadView?.video_results)
      ? activeThreadView.video_results
      : Array.isArray(activeThreadView?.task_results)
        ? activeThreadView.task_results
        : [];
    rows.forEach((item) => {
      const sid = Number(item?.segment_id);
      if (!Number.isFinite(sid)) return;
      map[sid] = item;
    });
    return map;
  }, [activeThreadView?.task_results, activeThreadView?.video_results]);
  const activeAllSegmentIds = useMemo(
    () =>
      activeSegments
        .map((seg) => Number(seg?.segment_id))
        .filter((sid) => Number.isFinite(sid)),
    [activeSegments],
  );
  const activeSortedSegments = useMemo(
    () =>
      activeSegments
        .slice()
        .sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0)),
    [activeSegments],
  );
  const activeVideoTailSelection = videoTailRegenerateSelectionBySession[activeSessionId] || {};
  const activeVideoTailSelecting = Boolean(activeVideoTailSelection.selecting);
  const activeVideoTailStartId = Number(activeVideoTailSelection.selectedSegmentId);
  const activeVideoTailStartIndex = activeSortedSegments.findIndex(
    (seg) => Number(seg?.segment_id) === activeVideoTailStartId,
  );
  const activeVideoTailSelectedOrdinal =
    activeVideoTailStartIndex >= 0 ? activeVideoTailStartIndex + 1 : null;
  const activeProgressMessage =
    (typeof activeThreadView?.message === "string" && activeThreadView.message.trim()) || "暂无任务进度";
  const activeProgressValue = typeof activeThreadView?.progress === "number" ? `${activeThreadView.progress}%` : "--";
  const activeProgressStep = activeThreadView?.current_step || "-";
  const activeProgressStatus = activeThreadView?.status || "idle";
  const inputPlaceholder = activeVideoReview
    ? "请输入视频不满意的点，点击“反馈重写分镜”提交（Shift+Enter 换行）"
    : activeScriptReview
    ? "请输入重写要求，点击“反馈重写”提交（Shift+Enter 换行）"
    : "发消息…（Shift+Enter 换行）";

  /** 同一 session + thread + 分镜指纹只往聊天里推一次，避免 SSE `state` 重复刷气泡 */
  const segmentChatFingerprintRef = useRef({});
  /** 与 setState 同步，便于 SSE progress 连续事件内合并上一帧视图 */
  const threadViewBySessionRef = useRef(threadViewBySession);
  /** 线程进度类气泡去重：key = `${sessionId}:${threadId}` → fingerprint */
  const threadProgressNoticeFpRef = useRef({});
  /** WS 任务状态通知去重：key = `${sessionId}:${fingerprint}` */
  const wsGenNoticeFpRef = useRef({});
  /** 每个会话最近一次分镜源内容指纹，用于在分镜重新生成时重置编辑草稿 */
  const segmentSourceFingerprintRef = useRef({});
  /** generation_id -> sessionId，用于把 WS 状态准确路由到对应会话 */
  const generationSessionRef = useRef({});
  /** generation_id -> segment_id（按会话） */
  const generationToSegmentBySessionRef = useRef({});
  const segmentCacheBySessionRef = useRef({});
  const generateBootstrapRef = useRef(null);

  useEffect(() => {
    threadViewBySessionRef.current = threadViewBySession;
  }, [threadViewBySession]);

  useEffect(() => {
    threadBySessionRef.current = threadBySession;
  }, [threadBySession]);

  useEffect(() => {
    generationToSegmentBySessionRef.current = generationToSegmentBySession;
  }, [generationToSegmentBySession]);

  useEffect(() => {
    segmentCacheBySessionRef.current = segmentCacheBySession;
  }, [segmentCacheBySession]);

  useEffect(() => {
    if (!liveSegments.length) return;
    setSegmentCacheBySession((prev) => ({
      ...prev,
      [activeSessionId]: liveSegments,
    }));
  }, [activeSessionId, liveSegments]);

  useEffect(() => {
    if (activeVideoReview) return;
    setVideoTailRegenerateSelectionBySession((prev) => {
      if (!prev[activeSessionId]) return prev;
      const next = { ...prev };
      delete next[activeSessionId];
      return next;
    });
  }, [activeSessionId, activeVideoReview]);

  useEffect(() => {
    const next = {};
    Object.entries(threadViewBySession).forEach(([sessionId, view]) => {
      const taskResults = view?.task_results;
      if (!Array.isArray(taskResults)) return;
      taskResults.forEach((item) => {
        const gid = Number(item?.generation_id);
        if (!Number.isFinite(gid)) return;
        next[gid] = sessionId;
      });
    });
    generationSessionRef.current = next;
  }, [threadViewBySession]);

  useEffect(() => {
    setGenerationToSegmentBySession((prev) => {
      let changed = false;
      const merged = { ...prev };
      Object.entries(threadViewBySession).forEach(([sessionId, view]) => {
        const taskResults = view?.task_results;
        if (!Array.isArray(taskResults) || !taskResults.length) return;
        const sessionMap = { ...(merged[sessionId] || {}) };
        taskResults.forEach((item) => {
          const gid = Number(item?.generation_id);
          const sid = Number(item?.segment_id);
          if (!Number.isFinite(gid) || !Number.isFinite(sid)) return;
          if (sessionMap[gid] === sid) return;
          sessionMap[gid] = sid;
          changed = true;
        });
        merged[sessionId] = sessionMap;
      });
      return changed ? merged : prev;
    });
  }, [threadViewBySession]);

  useEffect(() => {
    if (!activeSegments.length) return;
    const normalized = [...activeSegments]
      .sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0))
      .map((seg) => {
        const sid = Number(seg?.segment_id);
        const text =
          (typeof seg?.description === "string" && seg.description.trim()) ||
          (typeof seg?.description_en === "string" && seg.description_en.trim()) ||
          "";
        return `${sid}:${text}`;
      })
      .join("¦");
    const fp = `${activeSessionId}|${normalized}`;
    if (segmentSourceFingerprintRef.current[activeSessionId] === fp) return;
    segmentSourceFingerprintRef.current[activeSessionId] = fp;
    setSegmentDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: Object.fromEntries(
        activeSegments.map((seg) => {
          const sid = Number(seg?.segment_id);
          return [sid, getSegmentDescriptionText(seg)];
        }),
      ),
    }));
    setSegmentDurationDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: Object.fromEntries(
        activeSegments.map((seg) => {
          const sid = Number(seg?.segment_id);
          return [sid, coerceSegmentDurationFromBackend(seg?.duration)];
        }),
      ),
    }));
    setSegmentFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: {},
    }));
    setSegmentBulkFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: false,
    }));
  }, [activeSegments, activeSessionId]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeSegments.length, scrollToBottom]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    const fromLocation = parseGenerateBootstrap(location.state?.generateBootstrap);
    let fromStorage = null;

    if (!fromLocation) {
      if (vcInit.hadSnapshot) return;
      try {
        const raw = sessionStorage.getItem(VIDEO_CHAT_BOOTSTRAP_KEY);
        fromStorage = parseGenerateBootstrap(raw ? JSON.parse(raw) : null);
      } catch {
        fromStorage = null;
      }
    }

    const incoming = fromLocation || fromStorage;
    if (!incoming) return;

    const bootstrapFingerprint = `${incoming.createdAt || ""}|${incoming.title || ""}`;
    if (generateBootstrapRef.current === bootstrapFingerprint) return;
    generateBootstrapRef.current = bootstrapFingerprint;

    try {
      sessionStorage.removeItem(VIDEO_CHAT_BOOTSTRAP_KEY);
    } catch {
      // ignore
    }

    const prevSessionId = activeSessionIdRef.current;
    const prevEs = threadStreamRef.current[prevSessionId];
    if (prevEs) {
      try { prevEs.close(); } catch { /* ignore */ }
      delete threadStreamRef.current[prevSessionId];
    }

    const sessionId = `s-${uid()}`;

    if (incoming.videoParams && typeof incoming.videoParams === "object") {
      const normalizedParams = cloneVideoParams({
        ...DEFAULT_VIDEO_PARAMS,
        ...incoming.videoParams,
        generationMode: "multimodal_reference",
      });
      setVideoParamsBySession((prev) => ({ ...prev, [sessionId]: normalizedParams }));
      setParamDraftBySession((prev) => ({ ...prev, [sessionId]: normalizedParams }));
    }
    const titleCandidate = incoming?.title || incoming?.createPayload?.product?.name || "新生成任务";
    const title = String(titleCandidate).slice(0, 24) || "新生成任务";
    const now = Date.now();

    setSessions((prev) => [{ id: sessionId, title, updatedAt: now }, ...prev]);
    setActiveSessionId(sessionId);
    setCreatePayloadBySession((prev) => ({
      ...prev,
      [sessionId]: deepCloneJson(incoming.createPayload),
    }));
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: [
        {
          id: uid(),
          role: "assistant",
          content: WELCOME_TEXT,
        },
        ...buildBootstrapContextAssistantMessages(incoming.createPayload),
      ],
    }));

    setThreadBySession((prev) => ({ ...prev, [sessionId]: "" }));
    setThreadViewBySession((prev) => ({ ...prev, [sessionId]: null }));
    setThreadRequestingBySession((prev) => ({ ...prev, [sessionId]: false }));
    setGenerationToSegmentBySession((prev) => ({ ...prev, [sessionId]: {} }));
    setSegmentCacheBySession((prev) => ({ ...prev, [sessionId]: [] }));
    setSegmentDraftBySession((prev) => ({ ...prev, [sessionId]: {} }));
    setSegmentDurationDraftBySession((prev) => ({ ...prev, [sessionId]: {} }));
    setSegmentSubmittingBySession((prev) => ({ ...prev, [sessionId]: {} }));

    const productImageUrlRaw = incoming?.createPayload?.product?.image_url;
    const productNameRaw = incoming?.createPayload?.product?.name;
    const productImageUrl = typeof productImageUrlRaw === "string" ? productImageUrlRaw.trim() : "";
    const productDisplayName =
      typeof productNameRaw === "string" ? productNameRaw.trim() : "";
    if (productImageUrl) {
      const entry = createBootstrapProductImageEntry(productImageUrl, productDisplayName);
      if (entry) {
        const next = { ...EMPTY_PENDING_REFERENCE_ASSETS, images: [entry] };
        if (validateReferenceAggregates(next).ok) {
          setPendingReferenceAssetsBySession((prev) => ({ ...prev, [sessionId]: next }));
        }
      }
    }

    setPendingReferenceAssetsBySession((prev) =>
      prev[sessionId] ? prev : { ...prev, [sessionId]: { ...EMPTY_PENDING_REFERENCE_ASSETS } },
    );
    setVideoParamsBySession((prev) =>
      prev[sessionId] ? prev : { ...prev, [sessionId]: cloneVideoParams(DEFAULT_VIDEO_PARAMS) },
    );
    setParamDraftBySession((prev) =>
      prev[sessionId] ? prev : { ...prev, [sessionId]: cloneVideoParams(DEFAULT_VIDEO_PARAMS) },
    );

    setDraft("");
  }, [location.state, vcInit.hadSnapshot]);

  /** 从历史气泡中的「推广产品」同步首图 chip（按会话；仅在该会话尚无参考图时填充）。 */
  useEffect(() => {
    const found = findBootstrapProductImageInMessages(messages);
    if (!found) return;
    const sid = activeSessionId;
    setPendingReferenceAssetsBySession((prev) => {
      const cur = prev[sid] ?? { ...EMPTY_PENDING_REFERENCE_ASSETS };
      if (cur.images.length > 0) return prev;
      const entry = createBootstrapProductImageEntry(found.url, found.name);
      if (!entry) return prev;
      const merged = { ...cur, images: [entry] };
      return validateReferenceAggregates(merged).ok ? { ...prev, [sid]: merged } : prev;
    });
  }, [activeSessionId, messages]);

  useEffect(() => {
    let disposed = false;
    const checkLoginStatus = async () => {
      try {
        const res = await authFetch(`${MERCHANT_API_BASE}/info`);
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          if (!disposed) setCurrentUser(json?.data || json || null);
        } else if (res.status === 401 || res.status === 403) {
          antMessage.warning(
            res.status === 403
              ? "账号不可用，请返回首页重新登录"
              : "请先登录后再使用视频生成功能"
          );
          if (!disposed) setCurrentUser(null);
        } else {
          antMessage.error("暂时无法验证登录，请稍后重试");
          if (!disposed) setCurrentUser(null);
        }
      } catch (e) {
        if (e instanceof Error && e.message === "AUTH_EXPIRED") {
          antMessage.warning("登录状态失效，请返回首页重新登录");
        } else {
          antMessage.error("网络异常，请稍后重试");
        }
        if (!disposed) setCurrentUser(null);
      } finally {
        if (!disposed) setAuthChecking(false);
      }
    };
    void checkLoginStatus();
    return () => {
      disposed = true;
    };
  }, [navigate]);

  const persistVideoChatSnapshot = useCallback(() => {
    if (typeof sessionStorage === "undefined") return;
    try {
      const pendingSerialized = {};
      for (const [k, v] of Object.entries(pendingReferenceAssetsBySession)) {
        pendingSerialized[k] = serializePendingReferenceAssets(v);
      }
      const payload = {
        v: VIDEO_CHAT_SNAPSHOT_VERSION,
        savedAt: Date.now(),
        sessions,
        activeSessionId,
        messagesBySession,
        draft,
        pendingReferenceAssetsBySession: pendingSerialized,
        createPayloadBySession,
        videoParamsBySession,
        paramDraftBySession,
        threadBySession,
        threadViewBySession,
        generationStatusById,
        generationToSegmentBySession,
        segmentCacheBySession,
        segmentDraftBySession,
        segmentDurationDraftBySession,
      };
      sessionStorage.setItem(VIDEO_CHAT_SNAPSHOT_KEY, JSON.stringify(payload));
    } catch {
      // 配额或其它写入失败时忽略
    }
  }, [
    sessions,
    activeSessionId,
    messagesBySession,
    draft,
    pendingReferenceAssetsBySession,
    createPayloadBySession,
    videoParamsBySession,
    paramDraftBySession,
    threadBySession,
    threadViewBySession,
    generationStatusById,
    generationToSegmentBySession,
    segmentCacheBySession,
    segmentDraftBySession,
    segmentDurationDraftBySession,
  ]);

  useEffect(() => {
    persistVideoChatSnapshot();
  }, [persistVideoChatSnapshot]);

  useEffect(() => {
    const flush = () => persistVideoChatSnapshot();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [persistVideoChatSnapshot]);

  useEffect(() => {
    manualCloseRef.current = false;
    let disposed = false;
    let socket = null;

    const openWebSocket = () => {
      if (disposed) return;

      const baseUrl = getVideoTasksWebSocketBaseUrl();
      if (!baseUrl) {
        antMessage.warning("无法解析实时连接地址");
        return;
      }

      const token = getAccessToken();
      if (!token) {
        antMessage.warning("登录态缺失，无法建立实时连接，请重新登录");
        return;
      }

      const separator = baseUrl.includes("?") ? "&" : "?";
      const wsUrl = `${baseUrl}${separator}access_token=${encodeURIComponent(token)}`;

      socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      wsOpenedRef.current = false;

      socket.onopen = () => {
        // 仅处理当前仍挂在 wsRef 上的连接，避免依赖项重跑时旧 socket 晚到的 onopen 误报成功
        if (socket !== wsRef.current) return;
        antMessage.success("实时连接已建立");
        setWsConnected(true);
        wsOpenedRef.current = true;
      };

      socket.onmessage = (event) => {
        if (socket !== wsRef.current) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.event === "ping") {
            socket.send(JSON.stringify({ event: "pong" }));
            return;
          }

          /**
           * 后端通过 WS 推送生成状态：
           * {"event":"generation_status","generation_id":123,"status":"running|succeeded|failed",...}
           * 这里转成用户可见的聊天提示，便于在当前会话中实时感知状态变化。
           */
          if (payload?.event === "generation_status") {
            const generationId = Number(payload?.generation_id);
            const mappedSessionId = Number.isFinite(generationId) ? generationSessionRef.current[generationId] : "";
            const sessionId = mappedSessionId || activeSessionIdRef.current;
            const status = payload?.status || "unknown";
            const dedupeKey = `${sessionId}|${generationId}|${status}|${payload?.message || ""}|${payload?.progress ?? ""}|${payload?.current_step || payload?.step || ""}`;
            if (wsGenNoticeFpRef.current[dedupeKey]) return;
            wsGenNoticeFpRef.current[dedupeKey] = true;

            if (Number.isFinite(generationId)) {
              setGenerationStatusById((prev) => ({
                ...prev,
                [generationId]: {
                  ...(prev[generationId] || {}),
                  status,
                  video_url: payload?.video_url || prev[generationId]?.video_url || "",
                  error_message: payload?.error_message || prev[generationId]?.error_message || "",
                },
              }));

              setGenerationToSegmentBySession((prev) => {
                const sessionMap = { ...(prev[sessionId] || {}) };
                if (sessionMap[generationId]) return prev;

                const view = threadViewBySessionRef.current[sessionId];
                const taskResults = view?.task_results;
                if (Array.isArray(taskResults)) {
                  const hit = taskResults.find((item) => Number(item?.generation_id) === generationId);
                  const mappedSid = Number(hit?.segment_id);
                  if (Number.isFinite(mappedSid)) {
                    return {
                      ...prev,
                      [sessionId]: {
                        ...sessionMap,
                        [generationId]: mappedSid,
                      },
                    };
                  }
                }

                const segments = segmentCacheBySessionRef.current[sessionId] || [];
                const candidateIds = segments
                  .map((seg) => Number(seg?.segment_id))
                  .filter((sid) => Number.isFinite(sid))
                  .sort((a, b) => a - b);
                if (!candidateIds.length) return prev;
                const assigned = new Set(Object.values(sessionMap).map((sid) => Number(sid)).filter((sid) => Number.isFinite(sid)));
                const nextSid = candidateIds.find((sid) => !assigned.has(sid));
                if (!Number.isFinite(nextSid)) return prev;
                return {
                  ...prev,
                  [sessionId]: {
                    ...sessionMap,
                    [generationId]: nextSid,
                  },
                };
              });
            }

            const body = formatGenerationStatusChatBody(payload);
            setMessagesBySession((prev) => {
              const list = prev[sessionId] || [];
              return {
                ...prev,
                [sessionId]: [...list, { id: uid(), role: "assistant", content: `系统通知：\n${body}` }],
              };
            });
          }
        } catch {
          // 忽略非 JSON 文本帧（例如上游异常数据）
        }
      };

      socket.onclose = (e) => {
        // 旧连接被 effect 清理或已被新连接替换后，onclose 可能晚到；勿与当前连接混淆
        if (socket !== wsRef.current) return;
        setWsConnected(false);
        if (manualCloseRef.current) return;
        if (!wsOpenedRef.current) {
          const code = e?.code ?? "unknown";
          const reason = (e?.reason && String(e.reason)) || "";
          let hint = "";
          if (code === 4001) {
            hint = "（鉴权失败，请重新登录）";
          } else if (code === 1006) {
            hint = "（常见原因：access_token 失效/缺失、跨域、或网关未放行 WebSocket）";
          }
          antMessage.warning(
            `实时连接未建立（code: ${code}${reason ? `，${reason}` : ""}）${hint}`.trim(),
          );
        }
      };
    };

    openWebSocket();

    return () => {
      disposed = true;
      manualCloseRef.current = true;
      try {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ event: "close" }));
        }
      } catch {
        // ignore
      }
      try {
        socket?.close();
      } catch {
        // ignore
      }
      if (wsRef.current === socket) wsRef.current = null;
      setWsConnected(false);
    };
  }, [authChecking, currentUser, navigate]);

  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title || "新对话";

  const handleNewChat = () => {
    const id = `s-${uid()}`;
    const defaultVp = cloneVideoParams(DEFAULT_VIDEO_PARAMS);
    setSessions((prev) => [{ id, title: "新对话", updatedAt: Date.now() }, ...prev]);
    setActiveSessionId(id);
    setMessagesBySession((prev) => ({
      ...prev,
      [id]: [{ id: uid(), role: "assistant", content: WELCOME_TEXT, suggestions: true }],
    }));
    setPendingReferenceAssetsBySession((prev) => ({
      ...prev,
      [id]: { ...EMPTY_PENDING_REFERENCE_ASSETS },
    }));
    setVideoParamsBySession((prev) => ({ ...prev, [id]: cloneVideoParams(defaultVp) }));
    setParamDraftBySession((prev) => ({ ...prev, [id]: cloneVideoParams(defaultVp) }));
    setDraft("");
  };

  const appendMessages = useCallback((sessionId, updater) => {
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: updater(prev[sessionId] || []),
    }));
  }, []);

  const appendAssistantMessage = useCallback(
    (sessionId, content) => {
      appendMessages(sessionId, (list) => [...list, { id: uid(), role: "assistant", content }]);
    },
    [appendMessages]
  );

  const tryAppendSegmentsChat = useCallback(
    (sessionId, threadId, view) => {
      if (!threadId || !view || view.status !== "waiting_human") return;
      if (view.review_phase === "video" || view.current_step === "waiting_human_vd") return;
      const segments = view.segments;
      if (!Array.isArray(segments) || segments.length === 0) return;

      const fp = buildSegmentDraftFingerprint(threadId, segments);
      if (!fp || segmentChatFingerprintRef.current[sessionId] === fp) return;
      segmentChatFingerprintRef.current[sessionId] = fp;

      const sorted = [...segments].sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0));
      let summary = "";
      if (view.total_duration != null) summary += `总时长约 ${view.total_duration}s`;
      if (view.execution_strategy) summary += `${summary ? " · " : ""}${view.execution_strategy}`;
      if (view.revision_count != null && view.revision_count > 0) {
        summary += `${summary ? " · " : ""}已修订 ${view.revision_count} 轮`;
      }

      const lead = (view.message && String(view.message).trim()) || "请审阅剧本草稿并确认 / 修改 / 反馈";
      appendAssistantMessage(
        sessionId,
        `需要人工决策：${lead}\n已生成 ${sorted.length} 条分镜，请在「分镜清单」消息中逐条编辑或直接通过。${summary ? `\n（${summary}）` : ""}`,
      );
    },
    [appendAssistantMessage],
  );

  /** 把线程进度 / 全量 view 写入聊天（与仅更新顶栏的 setThreadView 互补）；去重避免 SSE 重复刷 */
  const tryAppendThreadViewProgressChat = useCallback(
    (sessionId, threadId, view) => {
      if (!threadId || !view) return;
      if (shouldSkipThreadProgressBubbleForView(view)) return;
      const body = formatThreadViewProgressBody(view);
      if (!body.trim()) return;
      const fp = fingerprintThreadProgress(threadId, view);
      const key = `${sessionId}:${threadId}`;
      if (threadProgressNoticeFpRef.current[key] === fp) return;
      threadProgressNoticeFpRef.current[key] = fp;
      appendAssistantMessage(sessionId, `系统通知：\n${body}`);
    },
    [appendAssistantMessage],
  );

  const handleSegmentDraftChange = useCallback((segmentId, value) => {
    setSegmentDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: {
        ...(prev[activeSessionId] || {}),
        [segmentId]: value,
      },
    }));
  }, [activeSessionId]);

  const handleSegmentDurationDraftChange = useCallback((segmentId, value) => {
    setSegmentDurationDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: {
        ...(prev[activeSessionId] || {}),
        [segmentId]: value,
      },
    }));
  }, [activeSessionId]);

  const startSegmentInlineFieldEdit = useCallback((segmentId) => {
    setSegmentBulkFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: false,
    }));
    setSegmentFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: { ...(prev[activeSessionId] || {}), [segmentId]: true },
    }));
  }, [activeSessionId]);

  const cancelSegmentInlineFieldEdit = useCallback((segment) => {
    const sid = Number(segment?.segment_id);
    if (!Number.isFinite(sid)) return;
    const originalText = getSegmentDescriptionText(segment);
    const originalDuration = coerceSegmentDurationFromBackend(segment?.duration);
    setSegmentDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: originalText },
    }));
    setSegmentDurationDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: originalDuration },
    }));
    setSegmentFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: false },
    }));
  }, [activeSessionId]);

  const startBulkSegmentFieldEdit = useCallback(() => {
    setSegmentFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: {},
    }));
    setSegmentBulkFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: true,
    }));
  }, [activeSessionId]);

  const cancelBulkSegmentFieldEdit = useCallback(() => {
    setSegmentDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: Object.fromEntries(
        activeSegments
          .filter((s) => Number.isFinite(Number(s?.segment_id)))
          .map((s) => [Number(s.segment_id), getSegmentDescriptionText(s)]),
      ),
    }));
    setSegmentDurationDraftBySession((prev) => ({
      ...prev,
      [activeSessionId]: Object.fromEntries(
        activeSegments
          .filter((s) => Number.isFinite(Number(s?.segment_id)))
          .map((s) => [Number(s.segment_id), coerceSegmentDurationFromBackend(s?.duration)]),
      ),
    }));
    setSegmentFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: {},
    }));
    setSegmentBulkFieldEditBySession((prev) => ({
      ...prev,
      [activeSessionId]: false,
    }));
  }, [activeSessionId, activeSegments]);

  const handleRefFilesChange = useCallback(async (e) => {
    const rawFiles = Array.from(e.target.files || []);
    e.target.value = "";
    if (!rawFiles.length) return;

    const bucketAdds = { images: [], audios: [], videos: [] };
    setUploadingReferences(true);
    try {
      for (const file of rawFiles) {
        const bucket = classifyReferenceFileStrict(file);
        if (!bucket) {
          antMessage.warning(
            `${file.name} 不支持：请上传图片（jpeg/png/webp/bmp/tiff/gif）、音频（wav/mp3）或参考视频（mp4/mov）`,
          );
          continue;
        }
        const result = await validateReferenceFile(file, bucket);
        if (!result.ok) {
          antMessage.warning(result.errors[0]);
          continue;
        }
        try {
          const uploaded = await uploadReferenceFile(file);
          bucketAdds[bucket].push({
            file,
            dataUrl: null,
            remoteUrl: uploaded.url,
            meta: {
              ...(result.meta || {}),
              uploadKey: uploaded.key,
            },
          });
        } catch (uploadError) {
          const detail = uploadError instanceof Error ? uploadError.message : "上传失败";
          antMessage.error(`「${file.name}」：${detail}`);
        }
      }
    } finally {
      setUploadingReferences(false);
    }

    const hasAny =
      bucketAdds.images.length > 0 ||
      bucketAdds.audios.length > 0 ||
      bucketAdds.videos.length > 0;
    if (!hasAny) return;

    const sid = activeSessionId;
    setPendingReferenceAssetsBySession((prev) => {
      const cur = prev[sid] ?? { ...EMPTY_PENDING_REFERENCE_ASSETS };
      const merged = {
        images: [...cur.images, ...bucketAdds.images],
        audios: [...cur.audios, ...bucketAdds.audios],
        videos: [...cur.videos, ...bucketAdds.videos],
      };
      const agg = validateReferenceAggregates(getUserReferenceAssets(merged));
      if (!agg.ok) {
        antMessage.warning(agg.errors[0]);
        return prev;
      }
      return { ...prev, [sid]: merged };
    });
  }, [activeSessionId]);

  const buildDraftCreatePayload = useCallback(
    (text) => {
      const basePayload = createPayloadBySession[activeSessionId] || DEMO_CREATE_THREAD_PAYLOAD;
      const payload = deepCloneJson(basePayload);
      payload.user_input = text || payload.user_input;
      payload.generation_mode = BACKEND_GENERATION_MODE_MULTIMODAL;
      // 先复用当前页面参数，后续你可替换成真正参数表单映射。
      payload.config_params = {
        resolution: videoParams.resolution,
        ratio: videoParams.ratio,
        language: videoParams.responseLang,
        watermark: videoParams.watermark,
        generate_audio: videoParams.generateAudio,
      };
      delete payload.media_assets;
      const media = buildPendingMediaAssetsPayload(pendingReferenceAssets);
      if (media) payload.media_assets = media;
      return payload;
    },
    [activeSessionId, createPayloadBySession, videoParams, pendingReferenceAssets]
  );

  const closeThreadStream = useCallback((sessionId) => {
    const es = threadStreamRef.current[sessionId];
    if (es) {
      try {
        es.close();
      } catch {
        // ignore
      }
      delete threadStreamRef.current[sessionId];
    }
  }, []);

  /** 单次拉取 /state（与 SSE 首包互补）；不再 setInterval 轮询。 */
  const fetchThreadStateOnce = useCallback(async (sessionId, threadId) => {
    try {
      const res = await authFetch(`${VIDEO_THREAD_API_BASE}/${encodeURIComponent(threadId)}/state`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const data = json?.data || {};
      if (data?.view) {
        threadViewBySessionRef.current[sessionId] = data.view;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: data.view }));
        tryAppendSegmentsChat(sessionId, threadId, data.view);
        tryAppendThreadViewProgressChat(sessionId, threadId, data.view);
      }
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        antMessage.warning("登录已过期，请返回首页重新登录");
      }
    }
  }, [tryAppendSegmentsChat, tryAppendThreadViewProgressChat]);

  /** 拉取 LangGraph 时间线并写入聊天区；需在连接 SSE /state 前完成，便于分镜指纹去重 */
  const fetchThreadHistoryOnce = useCallback(async (sessionId, threadId) => {
    try {
      const { ok, data, errText } = await loadThreadHistoryPayload(threadId);
      if (!ok || !data) {
        setMessagesBySession((prev) => ({
          ...prev,
          [sessionId]: [
            {
              id: uid(),
              role: "assistant",
              content: `加载会话历史失败：${typeof errText === "string" ? errText : "未知错误"}`,
            },
          ],
        }));
        return;
      }
      setCreatePayloadBySession((prev) => ({
        ...prev,
        [sessionId]: buildMergedCreatePayloadWithHistory(prev[sessionId], data),
      }));
      hydrateProductReferenceFromHistory(sessionId, data, setPendingReferenceAssetsBySession);
      const { messages, lastSegmentDraftFingerprint } = buildMessagesFromThreadHistoryPayload(
        threadId,
        data,
      );
      if (lastSegmentDraftFingerprint) {
        segmentChatFingerprintRef.current[sessionId] = lastSegmentDraftFingerprint;
      }
      setMessagesBySession((prev) => ({ ...prev, [sessionId]: messages }));
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        antMessage.warning("登录已过期，请返回首页重新登录");
      }
      setMessagesBySession((prev) => ({
        ...prev,
        [sessionId]: [
          {
            id: uid(),
            role: "assistant",
            content: `加载会话历史失败：${e instanceof Error ? e.message : "网络异常"}`,
          },
        ],
      }));
    }
  }, [setCreatePayloadBySession, setPendingReferenceAssetsBySession]);

  const startThreadStream = useCallback(
    (sessionId, threadId) => {
      closeThreadStream(sessionId);
      let fallbackStateFetched = false;
      const fetchStateOnStreamFailureOnce = () => {
        if (fallbackStateFetched) return;
        fallbackStateFetched = true;
        void fetchThreadStateOnce(sessionId, threadId);
      };

      const sseBaseUrl = `${VIDEO_THREAD_API_BASE}/${encodeURIComponent(threadId)}/stream`;
      const sseToken = getAccessToken();
      const sseUrl = sseToken
        ? `${sseBaseUrl}${sseBaseUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(sseToken)}`
        : sseBaseUrl;
      const es = new EventSource(sseUrl, { withCredentials: true });
      threadStreamRef.current[sessionId] = es;

      const parseEventData = (event) => {
        try {
          return JSON.parse(event.data || "{}");
        } catch {
          return {};
        }
      };

      const handleStreamDone = (data) => {
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const merged = {
          ...prevView,
          status: "finished",
          progress: 100,
          message: data?.message || "视频结果已确认",
          current_step: data?.step || "finished",
          review_phase: prevView.review_phase || "video",
        };
        threadViewBySessionRef.current[sessionId] = merged;
        appendAssistantMessage(sessionId, data?.message || "视频结果已确认。");
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: merged }));
        void fetchThreadStateOnce(sessionId, threadId);
        closeThreadStream(sessionId);
      };

      es.addEventListener("state", (event) => {
        const view = parseEventData(event);
        threadViewBySessionRef.current[sessionId] = view;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: view }));
        tryAppendSegmentsChat(sessionId, threadId, view);
        tryAppendThreadViewProgressChat(sessionId, threadId, view);
      });

      es.addEventListener("progress", (event) => {
        const data = parseEventData(event);

        if (data?.step === "done") {
          handleStreamDone(data);
          return;
        }

        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const merged = {
          ...prevView,
          status: "running",
          message: data?.message || prevView.message,
          progress: typeof data?.progress === "number" ? data.progress : prevView.progress || 0,
          current_step: data?.step || prevView.current_step,
        };
        threadViewBySessionRef.current[sessionId] = merged;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: merged }));
        tryAppendThreadViewProgressChat(sessionId, threadId, merged);
      });

      es.addEventListener("done", (event) => {
        handleStreamDone(parseEventData(event));
      });

      const hydrateWaitingHumanFromPayload = (data) => {
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const mergedView = {
          ...prevView,
          status: "waiting_human",
          message: data?.message || "请审阅剧本草稿并确认 / 修改 / 反馈",
          segments: data?.segments || [],
          total_duration: data?.total_duration,
          execution_strategy: data?.execution_strategy,
          revision_count: data?.revision_count,
          current_step: "waiting_human",
          progress: prevView.progress ?? 55,
        };
        threadViewBySessionRef.current[sessionId] = mergedView;
        setThreadViewBySession((prev) => ({
          ...prev,
          [sessionId]: mergedView,
        }));
        tryAppendSegmentsChat(sessionId, threadId, mergedView);
      };

      es.addEventListener("human_action_required", (event) => {
        hydrateWaitingHumanFromPayload(parseEventData(event));
      });

      es.addEventListener("require_human_input", (event) => {
        hydrateWaitingHumanFromPayload(parseEventData(event));
      });

      const hydrateWaitingVideoResultsFromPayload = (data) => {
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const mergedView = {
          ...prevView,
          status: "running",
          review_phase: "video_generating",
          message: data?.message || "视频生成中，完成后将自动进入审阅阶段",
          task_results: data?.task_results || prevView.task_results,
          current_step: "waiting_video_results",
          progress: prevView.progress ?? 98,
        };
        threadViewBySessionRef.current[sessionId] = mergedView;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: mergedView }));
        tryAppendThreadViewProgressChat(sessionId, threadId, mergedView);
      };

      es.addEventListener("waiting_video_results", (event) => {
        hydrateWaitingVideoResultsFromPayload(parseEventData(event));
      });

      const hydrateVideoReviewFromPayload = (data) => {
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const mergedView = {
          ...prevView,
          status: "waiting_human",
          review_phase: "video",
          message: data?.message || "请审阅视频生成结果",
          video_results: data?.segments || prevView.video_results || [],
          task_results: data?.task_results || prevView.task_results,
          target_segment_ids: data?.target_segment_ids || prevView.target_segment_ids,
          current_step: "waiting_human_vd",
          progress: 100,
        };
        threadViewBySessionRef.current[sessionId] = mergedView;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: mergedView }));
        tryAppendThreadViewProgressChat(sessionId, threadId, mergedView);
      };

      es.addEventListener("video_action_required", (event) => {
        hydrateVideoReviewFromPayload(parseEventData(event));
      });

      es.addEventListener("video_result_updated", (event) => {
        const data = parseEventData(event);
        const generationId = Number(data?.generation_id);
        if (Number.isFinite(generationId)) {
          setGenerationStatusById((prev) => ({
            ...prev,
            [generationId]: {
              ...(prev[generationId] || {}),
              status: data?.status || prev[generationId]?.status || "",
              video_url: data?.video_url || prev[generationId]?.video_url || "",
              error_message: data?.error_message || prev[generationId]?.error_message || "",
            },
          }));
          generationSessionRef.current[generationId] = sessionId;
        }
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const taskResults = Array.isArray(prevView.task_results)
          ? prevView.task_results.map((item) =>
              item?.task_id === data?.task_id
                ? {
                    ...item,
                    status: data?.status || item.status,
                    video_url: data?.video_url || item.video_url,
                    error_message: data?.error_message || item.error_message,
                  }
                : item,
            )
          : prevView.task_results;
        const merged = { ...prevView, task_results: taskResults };
        threadViewBySessionRef.current[sessionId] = merged;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: merged }));
      });

      es.addEventListener("segments_updated", (event) => {
        const data = parseEventData(event);
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const merged = {
          ...prevView,
          segments: data?.segments || prevView.segments,
          total_duration: data?.total_duration ?? prevView.total_duration,
          message: data?.message || prevView.message,
          current_step: data?.step || prevView.current_step,
        };
        threadViewBySessionRef.current[sessionId] = merged;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: merged }));
        if (Array.isArray(data?.segments) && data.segments.length) {
          setSegmentCacheBySession((prev) => ({
            ...prev,
            [sessionId]: data.segments,
          }));
        }
      });

      es.addEventListener("segment_submitted", (event) => {
        const data = parseEventData(event);
        if (data?.segment_id && data?.generation_id) {
          setGenerationToSegmentBySession((prev) => ({
            ...prev,
            [sessionId]: {
              ...(prev[sessionId] || {}),
              [data.generation_id]: data.segment_id,
            },
          }));
          generationSessionRef.current[data.generation_id] = sessionId;
        }
        const remaining = data?.remaining;
        if (typeof remaining === "number") {
          appendAssistantMessage(
            sessionId,
            `分镜 #${data.segment_id} 已提交生成（剩余 ${remaining} 段）`,
          );
        }
      });

      es.addEventListener("params_updated", (event) => {
        const data = parseEventData(event);
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const merged = {
          ...prevView,
          config_params: data?.config_params ?? prevView.config_params,
          generation_mode: data?.generation_mode ?? prevView.generation_mode,
          media_assets: data?.media_assets ?? prevView.media_assets,
        };
        threadViewBySessionRef.current[sessionId] = merged;
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: merged }));
      });

      es.addEventListener("warning", (event) => {
        const data = parseEventData(event);
        if (data?.message) {
          antMessage.warning(data.message);
          appendAssistantMessage(sessionId, `⚠ 警告：${data.message}`);
        }
      });

      es.addEventListener("error", (event) => {
        if (event instanceof MessageEvent && event.data) {
          const data = parseEventData(event);
          if (data?.message) {
            appendAssistantMessage(sessionId, `任务异常：${data.message}`);
            const prevView = threadViewBySessionRef.current[sessionId] || {};
            const merged = {
              ...prevView,
              status: "error",
              message: data.message,
              current_step: "error",
            };
            threadViewBySessionRef.current[sessionId] = merged;
            setThreadViewBySession((prev) => ({ ...prev, [sessionId]: merged }));
            closeThreadStream(sessionId);
            return;
          }
        }
        fetchStateOnStreamFailureOnce();
      });
    },
    [appendAssistantMessage, closeThreadStream, fetchThreadStateOnce, tryAppendSegmentsChat, tryAppendThreadViewProgressChat]
  );

  const fetchVideoThreadList = useCallback(async (opts) => {
    const showLoading = Boolean(opts?.showLoading);
    if (showLoading) setHistoryListLoading(true);
    try {
      const res = await authFetch(`${VIDEO_THREAD_API_BASE}/list?limit=50&offset=0`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (json?.code != null && Number(json.code) !== 0) return;
      const items = Array.isArray(json?.data?.items) ? json.data.items : [];
      setSessions((prev) =>
        mergeVideoThreadListIntoSessions(items, prev, threadBySessionRef.current),
      );
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        antMessage.warning("登录已过期，请返回首页重新登录");
      }
    } finally {
      if (showLoading) setHistoryListLoading(false);
    }
  }, []);

  const handleSelectSession = useCallback(
    (id) => {
      if (id === activeSessionId) return;
      const prevId = activeSessionIdRef.current;
      setActiveSessionId(id);
      setDraft("");
      setParamModalOpen(false);
      setPendingReferenceAssetsBySession((p) =>
        p[id] ? p : { ...p, [id]: { ...EMPTY_PENDING_REFERENCE_ASSETS } },
      );
      setVideoParamsBySession((p) =>
        p[id] ? p : { ...p, [id]: cloneVideoParams(DEFAULT_VIDEO_PARAMS) },
      );
      setParamDraftBySession((p) =>
        p[id] ? p : { ...p, [id]: cloneVideoParams(DEFAULT_VIDEO_PARAMS) },
      );
      if (prevId && prevId !== id) closeThreadStream(prevId);
      const tid = threadIdFromServerSessionId(id);
      if (!tid) return;
      setThreadBySession((p) => ({ ...p, [id]: tid }));
      setMessagesBySession((prev) => ({
        ...prev,
        [id]: [{ id: uid(), role: "assistant", content: "正在加载会话历史…" }],
      }));
      void (async () => {
        await fetchThreadHistoryOnce(id, tid);
        startThreadStream(id, tid);
        void fetchThreadStateOnce(id, tid);
      })();
    },
    [activeSessionId, closeThreadStream, fetchThreadHistoryOnce, fetchThreadStateOnce, startThreadStream],
  );

  useEffect(() => {
    if (authChecking) return;
    void fetchVideoThreadList({ showLoading: true });
  }, [authChecking, fetchVideoThreadList]);

  const createVideoThread = useCallback(
    async (sessionId, payload, successMessage = "线程创建成功，开始监听进度…") => {
      setThreadRequestingBySession((prev) => ({ ...prev, [sessionId]: true }));
      try {
        const res = await authFetch(`${VIDEO_THREAD_API_BASE}/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.detail || json?.message || "创建线程失败");
        }
        const data = json?.data || {};
        const threadId = data?.thread_id;
        if (!threadId) {
          throw new Error("后端未返回 thread_id");
        }
        setThreadBySession((prev) => ({ ...prev, [sessionId]: threadId }));
        if (data?.view) {
          threadViewBySessionRef.current[sessionId] = data.view;
          setThreadViewBySession((prev) => ({ ...prev, [sessionId]: data.view }));
          tryAppendThreadViewProgressChat(sessionId, threadId, data.view);
        }
        appendAssistantMessage(sessionId, `${successMessage}（thread_id: ${threadId}）`);
        startThreadStream(sessionId, threadId);
        void fetchThreadStateOnce(sessionId, threadId);
        void fetchVideoThreadList();
        return threadId;
      } catch (e) {
        const errorText = e instanceof Error ? e.message : "创建线程失败";
        appendAssistantMessage(sessionId, `创建失败：${errorText}`);
        if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
          antMessage.warning("登录已过期，请返回首页重新登录");
        } else {
          antMessage.error(errorText);
        }
        return "";
      } finally {
        setThreadRequestingBySession((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [appendAssistantMessage, fetchThreadStateOnce, fetchVideoThreadList, startThreadStream, tryAppendThreadViewProgressChat]
  );

  const resumeVideoThread = useCallback(
    async (sessionId, payload) => {
      const threadId = threadBySession[sessionId];
      if (!threadId) {
        antMessage.warning("当前会话还没有 thread_id，请先发起创建");
        return false;
      }
      setThreadRequestingBySession((prev) => ({ ...prev, [sessionId]: true }));
      try {
        const res = await authFetch(`${VIDEO_THREAD_API_BASE}/${encodeURIComponent(threadId)}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.detail || json?.message || "恢复线程失败");
        }
        const data = json?.data || {};
        if (data?.view) {
          threadViewBySessionRef.current[sessionId] = data.view;
          setThreadViewBySession((prev) => ({ ...prev, [sessionId]: data.view }));
          tryAppendThreadViewProgressChat(sessionId, threadId, data.view);
        }
        appendAssistantMessage(sessionId, `已提交人工决策：${payload.action}`);
        // resume 后继续监听同一个 thread，确保断流后仍可恢复状态。
        startThreadStream(sessionId, threadId);
        void fetchThreadStateOnce(sessionId, threadId);
        return true;
      } catch (e) {
        const errorText = e instanceof Error ? e.message : "恢复线程失败";
        appendAssistantMessage(sessionId, `恢复失败：${errorText}`);
        if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
          antMessage.warning("登录已过期，请返回首页重新登录");
        } else {
          antMessage.error(errorText);
        }
        return false;
      } finally {
        setThreadRequestingBySession((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [appendAssistantMessage, fetchThreadStateOnce, startThreadStream, threadBySession, tryAppendThreadViewProgressChat]
  );

  const handleSubmitSingleSegmentEdit = useCallback(
    async (segment) => {
      const sid = Number(segment?.segment_id);
      if (!Number.isFinite(sid)) return false;
      const value = (activeSegmentDraftMap[sid] ?? "").trim();
      if (!value) {
        antMessage.warning(`分镜 #${sid} 的描述不能为空`);
        return false;
      }
      const duration = resolveSegmentDurationDraft(sid, activeSegmentDurationDraftMap, segment);
      if (!isAllowedSegmentDuration(duration)) {
        antMessage.warning(`分镜 #${sid} 的时长须为 4–15 秒或「模型自主选择」(-1)`);
        return false;
      }
      setSegmentSubmittingBySession((prev) => ({
        ...prev,
        [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: true },
      }));
      try {
        const ok = await resumeVideoThread(activeSessionId, {
          action: "edit",
          edited_segments: [{ segment_id: sid, description: value, duration }],
          feedback: "",
          target_segment_ids: activeVideoReview ? [sid] : [],
        });
        if (ok) {
          setSegmentFieldEditBySession((prev) => ({
            ...prev,
            [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: false },
          }));
        }
        return ok;
      } finally {
        setSegmentSubmittingBySession((prev) => ({
          ...prev,
          [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: false },
        }));
      }
    },
    [
      activeSegmentDraftMap,
      activeSegmentDurationDraftMap,
      activeSessionId,
      activeVideoReview,
      resumeVideoThread,
    ],
  );

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (uploadingReferences) {
      antMessage.warning("参考文件正在上传，请稍后再发送");
      return;
    }

    const agg = validateReferenceAggregates(getUserReferenceAssets(pendingReferenceAssets));
    if (!agg.ok) {
      antMessage.error(agg.errors[0]);
      return;
    }

    const payload = buildDraftCreatePayload(text);
    const sizeOk = validateRequestBodyUnderLimit(payload);
    if (!sizeOk.ok) {
      antMessage.error(sizeOk.errors[0]);
      return;
    }

    const sessionId = activeSessionId;
    setSending(true);
    try {
      setDraft("");

      appendMessages(sessionId, (list) => [
        ...list.map((m) => ({ ...m, suggestions: false })),
        { id: uid(), role: "user", content: text },
      ]);

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                title:
                  s.title === "新对话" || s.title === "视频生成助手"
                    ? text.slice(0, 18) + (text.length > 18 ? "…" : "")
                    : s.title,
                updatedAt: Date.now(),
              }
            : s,
        ),
      );

      await createVideoThread(sessionId, payload);
      setPendingReferenceAssetsBySession((prev) => ({
        ...prev,
        [sessionId]: { ...EMPTY_PENDING_REFERENCE_ASSETS },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "发送失败";
      antMessage.error(msg);
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const handleResumeApprove = async () => {
    await resumeVideoThread(activeSessionId, {
      action: activeVideoReview ? "finished" : "approve",
      edited_segments: [],
      feedback: "",
      target_segment_ids: [],
    });
  };

  const handleResumeFeedback = async () => {
    const feedbackText = draft.trim();
    if (!feedbackText) {
      antMessage.warning("请先在输入框填写重写要求，再点击“反馈重写”");
      return;
    }
    const sessionId = activeSessionId;
    appendMessages(sessionId, (list) => [
      ...list.map((m) => ({ ...m, suggestions: false })),
      { id: uid(), role: "user", content: `反馈重写要求：${feedbackText}` },
    ]);
    const ok = await resumeVideoThread(sessionId, {
      action: "feedback",
      edited_segments: [],
      feedback: feedbackText,
      target_segment_ids: activeVideoReview ? activeAllSegmentIds : [],
    });
    if (ok) setDraft("");
  };

  const updateVideoTailRegenerateSelection = (patch) => {
    setVideoTailRegenerateSelectionBySession((prev) => ({
      ...prev,
      [activeSessionId]: {
        ...(prev[activeSessionId] || {}),
        ...patch,
      },
    }));
  };

  const clearVideoTailRegenerateSelection = () => {
    setVideoTailRegenerateSelectionBySession((prev) => {
      if (!prev[activeSessionId]) return prev;
      const next = { ...prev };
      delete next[activeSessionId];
      return next;
    });
  };

  const handleVideoTailSegmentSelect = (segmentId) => {
    const sid = Number(segmentId);
    if (activeVideoTailStartId === sid) {
      clearVideoTailRegenerateSelection();
      return;
    }
    updateVideoTailRegenerateSelection({
      selecting: true,
      selectedSegmentId: sid,
    });
    antMessage.info("再次点击该分镜可取消选中");
  };

  const handleVideoTailRegenerateButton = async () => {
    if (!activeVideoReview) return;
    if (!activeVideoTailSelecting) {
      updateVideoTailRegenerateSelection({ selecting: true, selectedSegmentId: null });
      return;
    }
    if (!Number.isFinite(activeVideoTailStartId) || activeVideoTailStartIndex < 0) {
      clearVideoTailRegenerateSelection();
      return;
    }
    const ids = activeSortedSegments
      .slice(activeVideoTailStartIndex)
      .map((seg) => Number(seg?.segment_id))
      .filter((sid) => Number.isFinite(sid));
    const ok = await handleResumeVideoRegenerate(ids, `从分镜 #${activeVideoTailStartId} 开始重生成后续视频段`);
    if (ok) clearVideoTailRegenerateSelection();
  };

  const handleResumeRegenerate = async () => {
    if (activeVideoReview) {
      await handleResumeVideoRegenerate(activeAllSegmentIds);
      return;
    }
    const feedbackText = draft.trim();
    if (!feedbackText) {
      antMessage.warning("请先在输入框填写重新生成要求");
      return;
    }
    const sessionId = activeSessionId;
    appendMessages(sessionId, (list) => [
      ...list.map((m) => ({ ...m, suggestions: false })),
      { id: uid(), role: "user", content: `重新生成要求：${feedbackText}` },
    ]);
    const ok = await resumeVideoThread(sessionId, {
      action: "feedback",
      edited_segments: [],
      feedback: feedbackText,
      target_segment_ids: [],
    });
    if (ok) setDraft("");
  };

  const handleResumeVideoRegenerate = async (segmentIds, messagePrefix = "按原分镜重生成视频段") => {
    const ids = (Array.isArray(segmentIds) ? segmentIds : [])
      .map((sid) => Number(sid))
      .filter((sid) => Number.isFinite(sid));
    if (!ids.length) {
      antMessage.warning("请选择需要重生成的视频段");
      return false;
    }
    const sessionId = activeSessionId;
    appendMessages(sessionId, (list) => [
      ...list.map((m) => ({ ...m, suggestions: false })),
      { id: uid(), role: "user", content: `${messagePrefix}：${ids.join(", ")}` },
    ]);
    return await resumeVideoThread(sessionId, {
      action: "regenerate",
      edited_segments: [],
      feedback: "",
      target_segment_ids: ids,
    });
  };

  const handleResumeEdit = useCallback(async () => {
    const segments = activeThreadView?.segments || [];
    if (!segments.length) {
      antMessage.warning("当前没有可编辑的分镜");
      return false;
    }
    const editedSegments = [];
    for (const seg of segments) {
      const sid = Number(seg?.segment_id);
      if (!Number.isFinite(sid)) continue;
      const originalText = getSegmentDescriptionText(seg);
      const draftText = (activeSegmentDraftMap[sid] ?? "").trim();
      if (!draftText) {
        antMessage.warning(`分镜 #${sid} 的描述不能为空`);
        return false;
      }
      const draftDuration = resolveSegmentDurationDraft(sid, activeSegmentDurationDraftMap, seg);
      if (!isAllowedSegmentDuration(draftDuration)) {
        antMessage.warning(`分镜 #${sid} 的时长须为 4–15 秒或「模型自主选择」(-1)`);
        return false;
      }
      const originalCoerced = coerceSegmentDurationFromBackend(seg?.duration);
      const durationChanged = draftDuration !== originalCoerced;
      if (!durationChanged && draftText === originalText) continue;
      editedSegments.push({
        segment_id: sid,
        description: draftText,
        duration: draftDuration,
      });
    }
    if (!editedSegments.length) {
      antMessage.info("请先在分镜清单里修改至少一条分镜内容或时长");
      return false;
    }
    const ok = await resumeVideoThread(activeSessionId, {
      action: "edit",
      edited_segments: editedSegments,
      feedback: "",
      target_segment_ids: activeVideoReview ? editedSegments.map((s) => s.segment_id) : [],
    });
    if (ok) {
      setSegmentBulkFieldEditBySession((prev) => ({
        ...prev,
        [activeSessionId]: false,
      }));
      setSegmentFieldEditBySession((prev) => ({
        ...prev,
        [activeSessionId]: {},
      }));
    }
    return ok;
  }, [
    activeSessionId,
    activeSegmentDraftMap,
    activeSegmentDurationDraftMap,
    activeThreadView?.segments,
    activeVideoReview,
    resumeVideoThread,
  ]);

  /** 页面刷新后，自动重连 snapshot 中未完成线程的 SSE 流并拉取最新状态 */
  const snapshotReconnectedRef = useRef(false);
  useEffect(() => {
    if (snapshotReconnectedRef.current) return;
    if (!vcInit.hadSnapshot) return;
    if (authChecking) return;
    snapshotReconnectedRef.current = true;

    const entries = Object.entries(vcInit.threadBySession || {});
    for (const [sessionId, threadId] of entries) {
      if (!threadId) continue;
      const view = vcInit.threadViewBySession?.[sessionId];
      if (view?.status === "finished" || view?.status === "error") continue;
      void (async () => {
        const { ok, data } = await loadThreadHistoryPayload(threadId);
        if (ok && data) {
          setCreatePayloadBySession((prev) => ({
            ...prev,
            [sessionId]: buildMergedCreatePayloadWithHistory(prev[sessionId], data),
          }));
          hydrateProductReferenceFromHistory(sessionId, data, setPendingReferenceAssetsBySession);
        }
      })();
      startThreadStream(sessionId, threadId);
      void fetchThreadStateOnce(sessionId, threadId);
    }
  }, [
    authChecking,
    vcInit.hadSnapshot,
    vcInit.threadBySession,
    vcInit.threadViewBySession,
    startThreadStream,
    fetchThreadStateOnce,
    setCreatePayloadBySession,
    setPendingReferenceAssetsBySession,
  ]);

  const handleReconnectActiveThread = useCallback(() => {
    const threadId = threadBySession[activeSessionId];
    if (!threadId) {
      antMessage.info("当前会话没有活跃线程");
      return;
    }
    antMessage.loading("正在重新连接…");
    startThreadStream(activeSessionId, threadId);
    void fetchThreadStateOnce(activeSessionId, threadId).then(() => {
      antMessage.destroy();
      antMessage.success("已重新连接并拉取最新状态");
    });
  }, [activeSessionId, threadBySession, startThreadStream, fetchThreadStateOnce]);

  useEffect(() => {
    return () => {
      Object.values(threadStreamRef.current).forEach((es) => {
        try {
          es?.close?.();
        } catch {
          // ignore
        }
      });
      threadStreamRef.current = {};
    };
  }, []);

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content).then(
      () => antMessage.success("已复制"),
      () => antMessage.error("复制失败"),
    );
  };

  const handleRegenerate = (messageId) => {
    appendMessages(activeSessionId, (list) =>
      list.map((msg) =>
        msg.id === messageId && msg.role === "assistant"
          ? {
              ...msg,
              content: "（演示）已重新生成一条回复文案，实际环境将由模型重新输出。",
            }
          : msg,
      ),
    );
  };

  const suggestionPicks = [
    "帮我生成 15 秒竖版短视频，突出产品卖点",
    "要科技感、冷色调、快节奏转场",
    "结尾加品牌 slogan 与行动号召",
  ];

  const activeSegmentPanel =
    activeSegments.length > 0 ? (
      <div className="video-chat-segment-panel">
        <div className="video-chat-segment-panel__head">
          <div className="video-chat-segment-panel__title">
            {activeVideoReview ? "视频结果审阅" : "分镜清单"}
          </div>
          <div className="video-chat-segment-panel__summary">{activeSegments.length} 条</div>
        </div>
        <div className="video-chat-segment-list">
          {activeSortedSegments
            .map((seg) => {
              const sid = Number(seg?.segment_id);
              if (!Number.isFinite(sid)) return null;
              const meta = getSegmentStatusMeta(activeThreadView?.status, activeTaskStatusMap[sid]);
              const videoResult = activeVideoResultMap[sid] || {};
              const segmentVideoUrl = activeSegmentVideoUrlMap[sid] || "";
              const segmentError = (activeSegmentErrorMap[sid] || videoResult?.error_message || "").trim();
              const taskStatus = activeTaskStatusMap[sid] || "";
              const draftValue = activeSegmentDraftMap[sid] ?? getSegmentDescriptionText(seg);
              const durationValue = resolveSegmentDurationDraft(sid, activeSegmentDurationDraftMap, seg);
              const segmentFieldEditing = Boolean(activeSegmentFieldEditMap[sid]);
              const segmentFieldEditable = segmentFieldEditing || activeSegmentBulkFieldEdit;
              const segmentControlsDisabled = !activeWaitingHuman || activeThreadRequesting;
              const durationTriggerDisabled = segmentControlsDisabled || !segmentFieldEditable;
              return (
                <div key={sid} className="video-chat-segment-item">
                  <div className="video-chat-segment-item__top">
                    <div className="video-chat-segment-item__title-wrap">
                      {activeVideoReview && activeVideoTailSelecting ? (
                        <input
                          type="radio"
                          className="video-chat-segment-item__tail-radio"
                          name={`video-tail-regenerate-${activeSessionId}`}
                          checked={activeVideoTailStartId === sid}
                          onClick={() => handleVideoTailSegmentSelect(sid)}
                          onChange={() => {}}
                          disabled={activeThreadRequesting}
                          aria-label={`选择从分镜 #${sid} 开始重生成后续视频`}
                        />
                      ) : null}
                      <div className="video-chat-segment-item__title">分镜 #{sid}</div>
                    </div>
                    <div className="video-chat-segment-item__status-wrap">
                      <span className={`video-chat-segment-item__status is-${meta.tone}`}>{meta.text}</span>
                      {taskStatus === "failed" ? (
                        <Tooltip title={segmentError || "暂无原因"} placement="top">
                          <span
                            className={`video-chat-segment-item__fail-hint${segmentError ? "" : " is-unknown"}`}
                            role="img"
                            aria-label={segmentError ? `失败原因：${segmentError}` : "暂无失败原因"}
                          >
                            {segmentError ? <InfoCircleOutlined /> : <QuestionCircleOutlined />}
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                  <div className="video-chat-segment-item__meta">
                    {seg?.mode ? <span>{seg.mode}</span> : null}
                    {activeVideoReview && videoResult?.task_id ? <span>task: {videoResult.task_id}</span> : null}
                    <div className="video-chat-segment-duration">
                      <span>时长</span>
                      <span className="video-chat-segment-duration__value" aria-live="polite">
                        {durationValue === SEGMENT_DURATION_AUTONOMOUS ? (
                          <>
                            -1
                            <span className="video-chat-segment-duration__hint">（模型自主选择）</span>
                          </>
                        ) : (
                          `${durationValue}s`
                        )}
                      </span>
                      <Dropdown
                        disabled={durationTriggerDisabled}
                        menu={{
                          items: [
                            {
                              key: "auto",
                              label: (
                                <span>
                                  -1
                                  <span className="video-chat-segment-duration__hint"> 模型自主选择</span>
                                </span>
                              ),
                            },
                            { type: "divider" },
                            ...SEGMENT_DURATION_SECONDS.map((s) => ({
                              key: String(s),
                              label: `${s}s`,
                            })),
                          ],
                          onClick: ({ key }) => {
                            if (key === "auto") handleSegmentDurationDraftChange(sid, SEGMENT_DURATION_AUTONOMOUS);
                            else handleSegmentDurationDraftChange(sid, Number(key));
                          },
                        }}
                        trigger={["click"]}
                      >
                        <Button
                          type="text"
                          size="small"
                          className="video-chat-segment-duration__trigger"
                          icon={<DownOutlined />}
                          aria-label={`分镜 #${sid} 选择时长`}
                          disabled={durationTriggerDisabled}
                        />
                      </Dropdown>
                    </div>
                  </div>
                  <div className="video-chat-segment-item__field-row">
                    <div
                      className={`video-chat-segment-item__textarea-wrap${
                        !segmentControlsDisabled && !segmentFieldEditable
                          ? " video-chat-segment-item__textarea-wrap--locked"
                          : ""
                      }`}
                    >
                      <Input.TextArea
                        value={draftValue}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        className="video-chat-segment-item__textarea"
                        disabled={segmentControlsDisabled}
                        readOnly={!segmentControlsDisabled && !segmentFieldEditable}
                        onChange={(e) => handleSegmentDraftChange(sid, e.target.value)}
                        placeholder="输入该分镜描述"
                      />
                    </div>
                    {segmentFieldEditing && !segmentControlsDisabled && !activeSegmentBulkFieldEdit ? (
                      <div className="video-chat-segment-item__field-aside">
                        <Button type="link" size="small" onClick={() => cancelSegmentInlineFieldEdit(seg)}>
                          取消修改
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="video-chat-segment-item__actions">
                    <Button
                      size="small"
                      onClick={() =>
                        segmentFieldEditing
                          ? void handleSubmitSingleSegmentEdit(seg)
                          : startSegmentInlineFieldEdit(sid)
                      }
                      loading={Boolean(activeSegmentSubmittingMap[sid])}
                      disabled={segmentControlsDisabled || activeSegmentBulkFieldEdit}
                    >
                      {segmentFieldEditing ? "确认修改" : "修改此分镜"}
                    </Button>
                    {activeVideoReview && (
                      <Button
                        size="small"
                        onClick={() => handleResumeVideoRegenerate([sid])}
                        loading={activeThreadRequesting}
                        disabled={activeThreadRequesting}
                      >
                        重新生成该分镜视频
                      </Button>
                    )}
                    {segmentVideoUrl && (
                      <Button size="small" type="link" onClick={() => handleCopy(segmentVideoUrl)}>
                        复制视频链接
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
        {activeWaitingHuman && (
          <div className="video-chat-segment-panel__actions">
            {activeVideoReview ? (
              <Button
                size="small"
                className="video-chat-segment-panel__tail-action"
                onClick={handleVideoTailRegenerateButton}
                loading={activeThreadRequesting}
                disabled={activeThreadRequesting || activeSegmentBulkFieldEdit || !activeSortedSegments.length}
              >
                {!activeVideoTailSelecting
                  ? "选择分镜并生成往后所有分镜"
                  : activeVideoTailSelectedOrdinal
                    ? `已选择第${activeVideoTailSelectedOrdinal}个分镜`
                    : "取消选择"}
              </Button>
            ) : null}
            <Button size="small" type="primary" onClick={handleResumeApprove} loading={activeThreadRequesting}>
              {activeVideoReview ? "确认成片" : "通过"}
            </Button>
            {!activeSegmentBulkFieldEdit ? (
              <Button
                size="small"
                onClick={startBulkSegmentFieldEdit}
                disabled={activeThreadRequesting}
              >
                修改全部分镜
              </Button>
            ) : (
              <>
                <Button
                  size="small"
                  onClick={() => void handleResumeEdit()}
                  loading={activeThreadRequesting}
                >
                  {`保存修改 ${segmentBulkDirtyStats.modifiedCount}/${segmentBulkDirtyStats.totalCount}`}
                </Button>
                <Button size="small" onClick={cancelBulkSegmentFieldEdit} disabled={activeThreadRequesting}>
                  {`取消修改 ${segmentBulkDirtyStats.modifiedCount}/${segmentBulkDirtyStats.totalCount}`}
                </Button>
              </>
            )}
            <Button size="small" onClick={handleResumeRegenerate} loading={activeThreadRequesting}>
              {activeVideoReview ? "按照当前分镜重新生成所有视频" : "重新生成"}
            </Button>
          </div>
        )}
      </div>
    ) : null;

  if (authChecking) {
    return (
      <s-page heading="视频生成">
        <s-section>
          <div className="dash-shell">
            <p className="dash-text-loading">正在加载登录信息...</p>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <>
      <button className="dash-back-btn video-chat-back" onClick={() => navigate("/app")} type="button" aria-label="返回首页">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>返回首页</span>
      </button>

      <div className="video-chat-page">
        <aside className={`video-chat-sidebar ${sidebarExpanded ? "video-chat-sidebar--expanded" : "video-chat-sidebar--collapsed"}`}>
          <div className="video-chat-sidebar__top">
            <div className="video-chat-sidebar__brand">
              <span className="video-chat-sidebar__avatar" aria-hidden>
                影
              </span>
              {sidebarExpanded && <span className="video-chat-sidebar__app-name">视频助手</span>}
            </div>
            <button
              type="button"
              className="video-chat-icon-btn"
              onClick={() => setSidebarExpanded((v) => !v)}
              aria-label={sidebarExpanded ? "收起侧栏" : "展开侧栏"}
            >
              {sidebarExpanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
            </button>
          </div>

          <Button
            type="primary"
            block
            className={`video-chat-new-btn ${sidebarExpanded ? "" : "video-chat-new-btn--icon-only"}`}
            icon={<PlusOutlined />}
            onClick={handleNewChat}
            title={sidebarExpanded ? undefined : "新对话"}
          >
            {sidebarExpanded ? "新对话" : null}
          </Button>

          <div className="video-chat-sidebar__section video-chat-sidebar__section--grow">
            {sidebarExpanded && (
              <div className="video-chat-sidebar__section-title">
                <HistoryOutlined /> 历史对话
                {historyListLoading ? (
                  <span className="video-chat-history-list__loading" aria-live="polite">
                    同步中…
                  </span>
                ) : null}
              </div>
            )}
            <ul className="video-chat-history-list">
              {historyItems.map((s) => {
                const initial = (s.title && s.title.trim().charAt(0)) || "·";
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`video-chat-history-item ${s.id === activeSessionId ? "is-active" : ""}`}
                      onClick={() => handleSelectSession(s.id)}
                      title={s.title}
                      aria-current={s.id === activeSessionId ? "true" : undefined}
                    >
                      {sidebarExpanded ? (
                        <span className="video-chat-history-text">{s.title}</span>
                      ) : (
                        <span className="video-chat-history-compact" aria-hidden>
                          {initial}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="video-chat-sidebar__footer">
            <span className="video-chat-sidebar__avatar video-chat-sidebar__avatar--sm" aria-hidden>
              {sidebarUserInitial}
            </span>
            {sidebarExpanded && <span className="video-chat-user-name">{sidebarUserName}</span>}
            <GiftOutlined className="video-chat-gift" />
          </div>
        </aside>

        <main className="video-chat-main">
          <header className="video-chat-main__header">
            <div className="video-chat-main__header-left">
              <h1 className="video-chat-main__title">{activeTitle}</h1>
              <span className="video-chat-param-pill" title="当前视频参数摘要">
                {paramSummary}
              </span>
            </div>
            <div className="video-chat-main__header-actions">
              <div className="video-chat-progress-box" aria-live="polite">
                <div className="video-chat-progress-box__title">当前进度</div>
                <div className="video-chat-progress-box__message">{activeProgressMessage}</div>
                <div className="video-chat-progress-box__meta">
                  进度 {activeProgressValue} · 步骤 {activeProgressStep} · 状态 {activeProgressStatus}
                </div>
              </div>
              <div className="video-chat-main__header-buttons">
                {activeThreadId && (
                  <Button size="small" icon={<ReloadOutlined />} onClick={handleReconnectActiveThread} disabled={activeThreadRequesting}>
                    重新连接
                  </Button>
                )}
                <button type="button" className="video-chat-icon-btn video-chat-share" aria-label="分享">
                  <ShareAltOutlined />
                </button>
              </div>
            </div>
          </header>

          <div className="video-chat-messages" ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} className={`video-chat-msg video-chat-msg--${m.role}`}>
                {m.role === "assistant" && <div className="video-chat-msg__role">助手</div>}
                <div className="video-chat-msg__bubble">
                  <div className="video-chat-msg__content">
                    {m.bootstrapContext ? (
                      <VideoChatBootstrapContextCard context={m.bootstrapContext} />
                    ) : m.historySegmentDraft ? (
                      <div className="video-chat-history-draft">
                        <div className="video-chat-history-draft__title">【分镜草稿】</div>
                        {m.historySegmentDraft.revisionCount != null ? (
                          <div className="video-chat-history-draft__meta">
                            修订轮次：{m.historySegmentDraft.revisionCount}
                          </div>
                        ) : null}
                        {m.historySegmentDraft.createdAt ? (
                          <div className="video-chat-history-draft__meta">
                            时间：{m.historySegmentDraft.createdAt}
                          </div>
                        ) : null}
                        {m.historySegmentDraft.durationSummary ? (
                          <div className="video-chat-history-draft__meta">
                            {m.historySegmentDraft.durationSummary}
                          </div>
                        ) : null}
                        {m.historySegmentDraft.emptySegments ? (
                          <p className="video-chat-history-draft__empty">（无分镜条目）</p>
                        ) : (
                          <ol className="video-chat-history-draft__list" aria-label="分镜列表">
                            {m.historySegmentDraft.items.map((it, idx) => (
                              <li
                                key={`${m.id}-draft-${it.segmentId ?? "x"}-${idx}`}
                                className="video-chat-history-draft__item"
                              >
                                <span className="video-chat-history-draft__item-text">
                                  {it.description}
                                  {it.durationLabel ? (
                                    <span className="video-chat-history-draft__dur">
                                      （{it.durationLabel}）
                                    </span>
                                  ) : null}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    ) : (
                      m.content
                    )}
                  </div>
                  {m.role === "assistant" && (
                    <div className="video-chat-msg__actions">
                      <button
                        type="button"
                        className="video-chat-msg__action"
                        aria-label="复制"
                        onClick={() => handleCopy(typeof m.copyText === "string" ? m.copyText : m.content)}
                      >
                        <CopyOutlined />
                      </button>
                      <button
                        type="button"
                        className="video-chat-msg__action"
                        aria-label="重新生成"
                        onClick={() => handleRegenerate(m.id)}
                      >
                        <ReloadOutlined />
                      </button>
                      <button type="button" className="video-chat-msg__action" aria-label="点赞">
                        <LikeOutlined />
                      </button>
                      <button type="button" className="video-chat-msg__action" aria-label="点踩">
                        <DislikeOutlined />
                      </button>
                    </div>
                  )}
                </div>
                {m.role === "assistant" && m.suggestions && (
                  <div className="video-chat-suggestions">
                    {suggestionPicks.map((q) => (
                      <button key={q} type="button" className="video-chat-chip" onClick={() => setDraft(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {activeSegmentPanel && (
              <div className="video-chat-msg video-chat-msg--assistant video-chat-msg--segments">
                <div className="video-chat-msg__role">助手</div>
                <div className="video-chat-msg__bubble">
                  <div className="video-chat-msg__content">{activeSegmentPanel}</div>
                </div>
              </div>
            )}
          </div>

          <div className="video-chat-input-wrap">
            <div className="video-chat-input-card">
              <input
                ref={refFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/bmp,image/gif,image/tiff,audio/wav,audio/mpeg,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.gif,.wav,.mp3,.mp4,.mov"
                multiple
                className="video-chat-ref-file-input"
                onChange={handleRefFilesChange}
              />
              {referenceAttachmentChipItems.length > 0 ? (
                <div className="video-chat-ref-chip-strip" role="list" aria-label="已选参考文件">
                  {referenceAttachmentChipItems.map((chip) => {
                    const chipNode = (
                      <span
                        className={`video-chat-ref-chip ${chip.isProductSlot ? "video-chat-ref-chip--product" : ""}`}
                        role="listitem"
                      >
                        <span className="video-chat-ref-chip__label">{chip.label}</span>
                        {chip.removable ? (
                          <button
                            type="button"
                            className="video-chat-ref-chip__close"
                            aria-label={`移除 ${chip.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removePendingReferenceSlot(chip.bucket, chip.index);
                            }}
                          >
                            <CloseOutlined aria-hidden />
                          </button>
                        ) : null}
                      </span>
                    );
                    return chip.isProductSlot ? (
                      <Tooltip key={chip.key} title="商品图必须上传" placement="top">
                        <span className="video-chat-ref-chip-anchor">{chipNode}</span>
                      </Tooltip>
                    ) : (
                      <span key={chip.key} className="video-chat-ref-chip-anchor">
                        {chipNode}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              <div className="video-chat-input-main">
                <button
                  type="button"
                  className="video-chat-upload-tile"
                  aria-label="上传参考文件"
                  title={
                    uploadingReferences
                      ? "参考文件上传中"
                      : pendingReferenceSummary
                      ? `已添加 ${pendingReferenceSummary}，点击继续添加`
                      : "上传参考文件（见「参考资源参数限制」）"
                  }
                  disabled={sending || uploadingReferences}
                  onClick={() => refFileInputRef.current?.click()}
                >
                  <span className="video-chat-upload-tile__surface">
                    <PlusOutlined className="video-chat-upload-tile__icon" aria-hidden />
                  </span>
                </button>
                <div className="video-chat-input-body">
                  <Input.TextArea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPressEnter={(e) => {
                      if (!e.shiftKey) {
                        e.preventDefault();
                        if (activeWaitingHuman) {
                          void handleResumeFeedback();
                          return;
                        }
                        handleSend();
                      }
                    }}
                    placeholder={inputPlaceholder}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    className="video-chat-textarea"
                    disabled={sending}
                  />
                  <div className="video-chat-input-footer">
                    <div className="video-chat-input-toolbar">
                      <Button
                        size="small"
                        type="default"
                        icon={<SettingOutlined />}
                        onClick={openParamModal}
                        className="video-chat-param-btn video-chat-param-btn--input"
                      >
                        视频参数
                      </Button>
                    </div>
                    <button
                      type="button"
                      className="video-chat-send-fab"
                      aria-label={activeWaitingHuman ? "提交反馈" : "发送"}
                      disabled={
                        sending ||
                        uploadingReferences ||
                        (activeWaitingHuman && activeThreadRequesting) ||
                        !draft.trim()
                      }
                      onClick={() => {
                        if (activeWaitingHuman) void handleResumeFeedback();
                        else void handleSend();
                      }}
                    >
                      <ArrowUpOutlined aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="video-chat-ref-rules-bar">
              <Button
                type="link"
                size="small"
                className="video-chat-ref-rules-btn"
                icon={<InfoCircleOutlined />}
                onClick={() => setReferenceRulesModalOpen(true)}
              >
                参考资源参数限制
              </Button>
            </div>
            <div className="video-chat-input-hint">
              Enter 发送 · 实时连接{wsConnected ? "已连接" : "未连接"} ·
              {activeThreadId ? ` 当前 thread: ${activeThreadId}` : " 尚未创建 thread"}
              {activeThreadView?.status ? ` · 状态: ${activeThreadView.status}` : ""}
              {activeThreadId && activeThreadView?.status && activeThreadView.status !== "finished" && activeThreadView.status !== "error" ? (
                <button
                  type="button"
                  className="video-chat-reconnect-link"
                  onClick={handleReconnectActiveThread}
                  style={{ marginLeft: 8, color: "var(--dash-accent, #1677ff)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: "inherit" }}
                >
                  重新连接SSE
                </button>
              ) : null}
            </div>
          </div>
        </main>
      </div>

      <Modal
        title="参考资源参数限制"
        open={referenceRulesModalOpen}
        onCancel={() => setReferenceRulesModalOpen(false)}
        footer={
          <Button type="primary" onClick={() => setReferenceRulesModalOpen(false)}>
            知道了
          </Button>
        }
        width={560}
        destroyOnHidden
        className="video-chat-ref-rules-modal"
      >
        <div className="video-chat-ref-rules-body">
          {REFERENCE_ASSETS_RULES_SECTIONS.map((section) => (
            <section key={section.title} className="video-chat-ref-rules-section">
              <h4 className="video-chat-ref-rules-section__title">{section.title}</h4>
              <ul className="video-chat-ref-rules-section__list">
                {section.bullets.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Modal>

      <Modal
        title="视频生成参数"
        open={paramModalOpen}
        onCancel={() => setParamModalOpen(false)}
        onOk={saveVideoParams}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnHidden
        className="video-chat-param-modal"
      >
        <div className="video-chat-param-form">
          <div className="video-chat-param-row">
            <label className="video-chat-param-label" htmlFor="vp-resolution">
              分辨率
            </label>
            <Select
              id="vp-resolution"
              value={paramDraft.resolution}
              onChange={(v) =>
                setParamDraftBySession((prev) => {
                  const base = prev[activeSessionId] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS);
                  return { ...prev, [activeSessionId]: { ...base, resolution: v } };
                })
              }
              options={RESOLUTION_OPTIONS}
              style={{ width: "100%" }}
            />
          </div>

          <div className="video-chat-param-row">
            <label className="video-chat-param-label" htmlFor="vp-ratio">
              长宽比 ratio
            </label>
            <Select
              id="vp-ratio"
              value={paramDraft.ratio}
              onChange={(v) =>
                setParamDraftBySession((prev) => {
                  const base = prev[activeSessionId] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS);
                  return { ...prev, [activeSessionId]: { ...base, ratio: v } };
                })
              }
              options={RATIO_OPTIONS}
              style={{ width: "100%" }}
            />
          </div>

          <div className="video-chat-param-row video-chat-param-row--switch">
            <span className="video-chat-param-label">携带 AI 生成水印</span>
            <Switch
              checked={paramDraft.watermark}
              onChange={(v) =>
                setParamDraftBySession((prev) => {
                  const base = prev[activeSessionId] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS);
                  return { ...prev, [activeSessionId]: { ...base, watermark: v } };
                })
              }
            />
          </div>

          <div className="video-chat-param-row video-chat-param-row--switch">
            <span className="video-chat-param-label">生成音频</span>
            <Switch
              checked={paramDraft.generateAudio}
              onChange={(v) =>
                setParamDraftBySession((prev) => {
                  const base = prev[activeSessionId] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS);
                  return { ...prev, [activeSessionId]: { ...base, generateAudio: v } };
                })
              }
            />
          </div>

          <div className="video-chat-param-row">
            <span className="video-chat-param-label">返回文字语言</span>
            <Select
              value={paramDraft.responseLang}
              onChange={(v) =>
                setParamDraftBySession((prev) => {
                  const base = prev[activeSessionId] ?? cloneVideoParams(DEFAULT_VIDEO_PARAMS);
                  return { ...prev, [activeSessionId]: { ...base, responseLang: v } };
                })
              }
              options={RESPONSE_LANG_OPTIONS}
              style={{ width: "100%" }}
            />
          </div>

          <div className="video-chat-param-row">
            <span className="video-chat-param-label">视频生成模式</span>
            <span className="video-chat-param-readonly" style={{ color: "rgba(0,0,0,0.65)" }}>
              多模态生成（固定，文案与参考素材由模型统一理解）
            </span>
          </div>
        </div>
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
