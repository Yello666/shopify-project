import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router";
import "../styles/video-chat.css";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { authFetch, clearAuthTokens } from "../utils/auth-api";
import { Button, Input, message as antMessage, Modal, Select, Switch, Radio, Upload } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined,
  PaperClipOutlined,
  ThunderboltOutlined,
  EditOutlined,
  VideoCameraOutlined,
  PictureOutlined,
  CodeOutlined,
  TranslationOutlined,
  MoreOutlined,
  AudioOutlined,
  ShareAltOutlined,
  CopyOutlined,
  ReloadOutlined,
  LikeOutlined,
  DislikeOutlined,
  CheckSquareOutlined,
  HistoryOutlined,
  GiftOutlined,
} from "@ant-design/icons";

const EMPTY_MESSAGES = [];

const WELCOME_TEXT =
  "你好，我是视频生成助手。你可以描述想要的画面、风格与时长，我会根据你的需求生成营销短视频（当前为界面演示，尚未连接后端）。";

const MOCK_TASKS = [
  { id: "t1", label: "夏季新品推广 · 生成中", active: true },
  { id: "t2", label: "热点借势 · 排队中", active: false },
];

const INPUT_TOOLS = [
  { key: "attach", icon: PaperClipOutlined, label: "附件" },
  { key: "quick", icon: ThunderboltOutlined, label: "快速" },
  { key: "write", icon: EditOutlined, label: "帮我写作" },
  { key: "video", icon: VideoCameraOutlined, label: "视频生成", primary: true },
  { key: "image", icon: PictureOutlined, label: "图像生成" },
  { key: "code", icon: CodeOutlined, label: "编程" },
  { key: "translate", icon: TranslationOutlined, label: "翻译" },
  { key: "more", icon: MoreOutlined, label: "更多" },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const DEFAULT_VIDEO_PARAMS = {
  resolution: "720p",
  ratio: "adaptive",
  watermark: true,
  generateAudio: true,
  generationMode: "text_to_video",
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

const GENERATION_MODE_OPTIONS = [
  { value: "text_to_video", label: "文字生成视频" },
  { value: "reference_to_video", label: "参考图生视频（1～4 张参考图）" },
  { value: "first_last_frame", label: "首尾帧生成视频" },
];

const RESPONSE_LANG_OPTIONS = [
  { value: "zh", label: "中文（zh）" },
  { value: "en", label: "英文（en）" },
];
const MERCHANT_API_BASE = "/api/merchant";
const VIDEO_THREAD_API_BASE = "/api/video-thread";
const UI_MODE_TO_BACKEND_MODE = {
  text_to_video: "text_to_video",
  reference_to_video: "image_to_video",
  first_last_frame: "frame_interpolation",
};
const VIDEO_CHAT_BOOTSTRAP_KEY = "video_chat_bootstrap_v1";

/**
 * WebSocket 地址（无 query），与后端 `video_tasks.py` 的 `/api/v1/video-tasks/stream` 对应。
 * 鉴权仅依赖浏览器自动携带的 Cookie（`access_token` 等），不在 URL 上附加 `token`。
 *
 * 优先级：`VITE_VIDEO_TASKS_WS_URL` → `VITE_API_ORIGIN` → 默认同源（`https` 用 `wss`，`http` 用 `ws`）。
 */
function getVideoTasksWebSocketBaseUrl() {
  const explicit = import.meta.env?.VITE_VIDEO_TASKS_WS_URL;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim().split(/[?#]/)[0];
  }

  const apiOrigin = import.meta.env?.VITE_API_ORIGIN;
  if (typeof apiOrigin === "string" && apiOrigin.trim()) {
    try {
      const u = new URL(apiOrigin.trim());
      const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
      const portPart = u.port ? `:${u.port}` : "";
      return `${wsProto}//${u.hostname}${portPart}/api/v1/video-tasks/stream`;
    } catch {
      // ignore
    }
  }

  if (typeof window === "undefined") return "";
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${window.location.host}/api/video-tasks/stream`;
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

function parseGenerateBootstrap(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.createPayload || typeof raw.createPayload !== "object") return null;
  return raw;
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
  if (view.status === "waiting_human" && Array.isArray(segs) && segs.length > 0) return true;
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
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sessions, setSessions] = useState(() => {
    const t = Date.now();
    return [
      { id: "s1", title: "视频生成助手", updatedAt: t },
      { id: "s2", title: "新品预告脚本", updatedAt: t - 1000 },
      { id: "s3", title: "社媒竖版短片", updatedAt: t - 2000 },
    ];
  });
  const [activeSessionId, setActiveSessionId] = useState("s1");
  const [messagesBySession, setMessagesBySession] = useState(() => ({
    s1: [{ id: "m0", role: "assistant", content: WELCOME_TEXT, suggestions: true }],
    s2: [
      { id: "m-s2-1", role: "assistant", content: "（演示）这是「新品预告脚本」里的消息区，与左侧其他条目内容不同。" },
      { id: "m-s2-2", role: "user", content: "突出礼盒开箱镜头" },
    ],
    s3: [{ id: "m-s3-1", role: "assistant", content: "（演示）这是「社媒竖版短片」里的消息区，用来预览切换效果。" }],
  }));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [videoParams, setVideoParams] = useState(() => cloneVideoParams(DEFAULT_VIDEO_PARAMS));
  const [paramModalOpen, setParamModalOpen] = useState(false);
  const [paramDraft, setParamDraft] = useState(() => cloneVideoParams(DEFAULT_VIDEO_PARAMS));
  const [threadBySession, setThreadBySession] = useState({});
  const [threadViewBySession, setThreadViewBySession] = useState({});
  const [threadRequestingBySession, setThreadRequestingBySession] = useState({});
  const [generationStatusById, setGenerationStatusById] = useState({});
  const [generationToSegmentBySession, setGenerationToSegmentBySession] = useState({});
  const [segmentCacheBySession, setSegmentCacheBySession] = useState({});
  const [segmentDraftBySession, setSegmentDraftBySession] = useState({});
  const [segmentSubmittingBySession, setSegmentSubmittingBySession] = useState({});
  const scrollRef = useRef(null);
  const wsRef = useRef(null);
  const wsOpenedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  const threadStreamRef = useRef({});

  const historyItems = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );
  const sidebarUserName = currentUser?.name || currentUser?.email || "商户";
  const sidebarUserInitial = sidebarUserName.trim().charAt(0) || "商";

  const openParamModal = () => {
    setParamDraft(cloneVideoParams(videoParams));
    setParamModalOpen(true);
  };

  const saveVideoParams = () => {
    if (paramDraft.generationMode === "reference_to_video" && !paramDraft.referenceUsageDescription.trim()) {
      antMessage.warning("参考图模式下请填写各参考图的用途说明（如：图1 为…）");
      return;
    }
    if (paramDraft.generationMode === "first_last_frame") {
      const hasFirst = paramDraft.firstFrameList?.length > 0;
      const hasLast = paramDraft.lastFrameList?.length > 0;
      if (!hasFirst && !hasLast) {
        antMessage.warning("首尾帧模式请至少上传首帧或尾帧之一");
        return;
      }
    }
    setVideoParams(cloneVideoParams(paramDraft));
    setParamModalOpen(false);
    antMessage.success("视频参数已保存");
  };

  const paramSummary = `${videoParams.resolution} · ${videoParams.ratio} · ${
    videoParams.generationMode === "text_to_video"
      ? "文字"
      : videoParams.generationMode === "reference_to_video"
        ? "参考图"
        : "首尾帧"
  }`;

  const messages = messagesBySession[activeSessionId] ?? EMPTY_MESSAGES;
  const activeThreadId = threadBySession[activeSessionId] || "";
  const activeThreadView = threadViewBySession[activeSessionId] || null;
  const activeWaitingHuman = activeThreadView?.status === "waiting_human";
  const activeThreadRequesting = Boolean(threadRequestingBySession[activeSessionId]);
  const liveSegments = Array.isArray(activeThreadView?.segments) ? activeThreadView.segments : [];
  const activeSegments = segmentCacheBySession[activeSessionId] || liveSegments;
  const activeSegmentDraftMap = segmentDraftBySession[activeSessionId] || {};
  const activeSegmentSubmittingMap = segmentSubmittingBySession[activeSessionId] || {};
  const activeGenerationToSegmentMap = generationToSegmentBySession[activeSessionId] || {};
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
        if (!Number.isFinite(sid) || !Number.isFinite(gid)) return;
        const url = generationStatusById[gid]?.video_url;
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
  const activeProgressMessage =
    (typeof activeThreadView?.message === "string" && activeThreadView.message.trim()) || "暂无任务进度";
  const activeProgressValue = typeof activeThreadView?.progress === "number" ? `${activeThreadView.progress}%` : "--";
  const activeProgressStep = activeThreadView?.current_step || "-";
  const activeProgressStatus = activeThreadView?.status || "idle";
  const inputPlaceholder = activeWaitingHuman
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
  const generateBootstrapSessionRef = useRef("");
  const generateBootstrapConsumedRef = useRef(false);

  useEffect(() => {
    threadViewBySessionRef.current = threadViewBySession;
  }, [threadViewBySession]);

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
          const text =
            (typeof seg?.description === "string" && seg.description.trim()) ||
            (typeof seg?.description_en === "string" && seg.description_en.trim()) ||
            "";
          return [sid, text];
        }),
      ),
    }));
  }, [activeSegments, activeSessionId]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    const fromLocation = parseGenerateBootstrap(location.state?.generateBootstrap);
    let fromStorage = null;

    if (!fromLocation) {
      try {
        const raw = sessionStorage.getItem(VIDEO_CHAT_BOOTSTRAP_KEY);
        fromStorage = parseGenerateBootstrap(raw ? JSON.parse(raw) : null);
      } catch {
        fromStorage = null;
      }
    }

    const incoming = fromLocation || fromStorage;
    if (!incoming) return;
    if (generateBootstrapConsumedRef.current) return;
    if (generateBootstrapRef.current) return;

    generateBootstrapRef.current = incoming;

    if (incoming.videoParams && typeof incoming.videoParams === "object") {
      const normalizedParams = cloneVideoParams({
        ...DEFAULT_VIDEO_PARAMS,
        ...incoming.videoParams,
      });
      setVideoParams(normalizedParams);
      setParamDraft(normalizedParams);
    }

    const sessionId = `s-${uid()}`;
    const titleCandidate = incoming?.title || incoming?.createPayload?.product?.name || "新生成任务";
    const title = String(titleCandidate).slice(0, 24) || "新生成任务";
    const now = Date.now();

    setSessions((prev) => [{ id: sessionId, title, updatedAt: now }, ...prev]);
    setActiveSessionId(sessionId);
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: [
        {
          id: uid(),
          role: "assistant",
          content: incoming?.skipAutoCreateThread
            ? "已接收上一步的热点与商品配置。尚未自动创建任务，你可以在下方输入或操作以开始生成。"
            : "已接收上一步配置，正在创建视频线程并开始监听进度。",
        },
      ],
    }));
    generateBootstrapSessionRef.current = sessionId;
  }, [location.state]);

  useEffect(() => {
    /**
     * 与首页一致：进入页面先验证登录态并读取用户信息。
     */
    let disposed = false;
    const checkLoginStatus = async () => {
      try {
        const res = await authFetch(`${MERCHANT_API_BASE}/info`);
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          if (!disposed) setCurrentUser(json?.data || json || null);
        } else if (res.status === 401 || res.status === 403) {
          clearAuthTokens();
          antMessage.warning(
            res.status === 403
              ? "账号不可用，请重新登录"
              : "请先登录后再使用视频生成功能"
          );
          navigate("/app");
        } else {
          antMessage.error("暂时无法验证登录，请稍后重试");
          if (!disposed) setCurrentUser(null);
        }
      } catch (e) {
        if (e instanceof Error && e.message === "AUTH_EXPIRED") {
          clearAuthTokens();
          antMessage.warning("登录状态失效，请重新登录");
          navigate("/app");
        } else {
          antMessage.error("网络异常，请稍后重试");
        }
      } finally {
        if (!disposed) setAuthChecking(false);
      }
    };
    void checkLoginStatus();
    return () => {
      disposed = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (authChecking || !currentUser) return undefined;
    manualCloseRef.current = false;
    let disposed = false;
    let socket = null;

    const openWebSocket = () => {
      if (disposed) return;

      const wsUrl = getVideoTasksWebSocketBaseUrl();
      if (!wsUrl) {
        antMessage.warning("无法解析实时连接地址");
        return;
      }

      socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      wsOpenedRef.current = false;

      socket.onopen = () => {
        setWsConnected(true);
        antMessage.success("实时连接已建立");
        wsOpenedRef.current = true;
        // 在聊天区追加系统提示，避免 toast 太快错过
        setMessagesBySession((prev) => {
          const list = prev[activeSessionId] || [];
          return {
            ...prev,
            [activeSessionId]: [...list, { id: uid(), role: "assistant", content: "系统提示：实时连接已建立。" }],
          };
        });
      };

      socket.onmessage = (event) => {
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
        setWsConnected(false);
        if (manualCloseRef.current) return;
        if (!wsOpenedRef.current) {
          const code = e?.code ?? "unknown";
          const reason = (e?.reason && String(e.reason)) || "";
          let hint = "";
          if (code === 4001) {
            hint = "（鉴权失败，请重新登录）";
          } else if (code === 1006) {
            hint = "（常见原因：未带上鉴权 Cookie、跨域、或网关未放行 WebSocket）";
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
    setSessions((prev) => [{ id, title: "新对话", updatedAt: Date.now() }, ...prev]);
    setActiveSessionId(id);
    setMessagesBySession((prev) => ({
      ...prev,
      [id]: [{ id: uid(), role: "assistant", content: WELCOME_TEXT, suggestions: true }],
    }));
    setDraft("");
  };

  const handleSelectSession = (id) => {
    if (id === activeSessionId) return;
    setActiveSessionId(id);
    setDraft("");
  };

  const appendMessages = (sessionId, updater) => {
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: updater(prev[sessionId] || []),
    }));
  };

  const appendAssistantMessage = useCallback(
    (sessionId, content) => {
      appendMessages(sessionId, (list) => [...list, { id: uid(), role: "assistant", content }]);
    },
    [appendMessages]
  );

  const tryAppendSegmentsChat = useCallback(
    (sessionId, threadId, view) => {
      if (!threadId || !view || view.status !== "waiting_human") return;
      const segments = view.segments;
      if (!Array.isArray(segments) || segments.length === 0) return;

      const sorted = [...segments].sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0));
      const fp = `${threadId}|${sorted
        .map((s) => `${s?.segment_id}:${s?.duration ?? ""}:${s?.mode ?? ""}:${String(s?.description || s?.description_en || "").slice(0, 48)}`)
        .join("¦")}`;
      if (segmentChatFingerprintRef.current[sessionId] === fp) return;
      segmentChatFingerprintRef.current[sessionId] = fp;

      let summary = "";
      if (view.total_duration != null) summary += `总时长约 ${view.total_duration}s`;
      if (view.execution_strategy) summary += `${summary ? " · " : ""}${view.execution_strategy}`;
      if (view.revision_count != null && view.revision_count > 0) {
        summary += `${summary ? " · " : ""}已修订 ${view.revision_count} 轮`;
      }

      const lead = (view.message && String(view.message).trim()) || "请审阅剧本草稿并确认 / 修改 / 反馈";
      appendAssistantMessage(
        sessionId,
        `需要人工决策：${lead}\n已生成 ${sorted.length} 条分镜，请在下方「分镜清单」逐条编辑或直接通过。${summary ? `\n（${summary}）` : ""}`,
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

  const buildDraftCreatePayload = useCallback(
    (text) => {
      const payload = deepCloneJson(DEMO_CREATE_THREAD_PAYLOAD);
      payload.user_input = text || payload.user_input;
      payload.generation_mode = UI_MODE_TO_BACKEND_MODE[videoParams.generationMode] || "text_to_video";
      // 先复用当前页面参数，后续你可替换成真正参数表单映射。
      payload.config_params = {
        resolution: videoParams.resolution,
        ratio: videoParams.ratio,
        language: videoParams.responseLang,
        watermark: videoParams.watermark,
        generate_audio: videoParams.generateAudio,
      };
      return payload;
    },
    [videoParams]
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
        antMessage.warning("登录已过期，请重新登录");
        navigate("/app");
      }
    }
  }, [navigate, tryAppendSegmentsChat, tryAppendThreadViewProgressChat]);

  const startThreadStream = useCallback(
    (sessionId, threadId) => {
      closeThreadStream(sessionId);
      let fallbackStateFetched = false;
      const fetchStateOnStreamFailureOnce = () => {
        if (fallbackStateFetched) return;
        fallbackStateFetched = true;
        void fetchThreadStateOnce(sessionId, threadId);
      };

      const es = new EventSource(`${VIDEO_THREAD_API_BASE}/${encodeURIComponent(threadId)}/stream`);
      threadStreamRef.current[sessionId] = es;

      const parseEventData = (event) => {
        try {
          return JSON.parse(event.data || "{}");
        } catch {
          return {};
        }
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

      // 与 LangGraph interrupt 返回字段对齐（event 名可能为 require_human_input）
      es.addEventListener("require_human_input", (event) => {
        hydrateWaitingHumanFromPayload(parseEventData(event));
      });

      es.addEventListener("done", (event) => {
        const data = parseEventData(event);
        const prevView = threadViewBySessionRef.current[sessionId] || {};
        const merged = {
          ...prevView,
          status: "finished",
          progress: 100,
          message: data?.message || "视频生成任务已成功提交",
          current_step: "done",
        };
        threadViewBySessionRef.current[sessionId] = merged;
        appendAssistantMessage(sessionId, "视频生成任务已提交完成。");
        setThreadViewBySession((prev) => ({ ...prev, [sessionId]: merged }));
        void fetchThreadStateOnce(sessionId, threadId);
        closeThreadStream(sessionId);
      });

      es.addEventListener("error", (event) => {
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
        // SSE 异常断开时补拉一次 /state（仅一次）。
        fetchStateOnStreamFailureOnce();
      });

      es.onerror = () => {
        fetchStateOnStreamFailureOnce();
      };
    },
    [appendAssistantMessage, closeThreadStream, fetchThreadStateOnce, tryAppendSegmentsChat, tryAppendThreadViewProgressChat]
  );

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
        return threadId;
      } catch (e) {
        const errorText = e instanceof Error ? e.message : "创建线程失败";
        appendAssistantMessage(sessionId, `创建失败：${errorText}`);
        if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
          antMessage.warning("登录已过期，请重新登录");
          navigate("/app");
        } else {
          antMessage.error(errorText);
        }
        return "";
      } finally {
        setThreadRequestingBySession((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [appendAssistantMessage, fetchThreadStateOnce, navigate, startThreadStream, tryAppendThreadViewProgressChat]
  );

  useEffect(() => {
    if (authChecking || !currentUser) return;
    if (generateBootstrapConsumedRef.current) return;

    const bootstrap = generateBootstrapRef.current;
    const sessionId = generateBootstrapSessionRef.current;
    if (!bootstrap || !sessionId) return;

    generateBootstrapConsumedRef.current = true;
    try {
      sessionStorage.removeItem(VIDEO_CHAT_BOOTSTRAP_KEY);
    } catch {
      // ignore
    }
    if (bootstrap.skipAutoCreateThread) {
      return;
    }
    void createVideoThread(
      sessionId,
      bootstrap.createPayload,
      "已同步生成页参数，线程创建成功，开始监听进度…",
    );
  }, [authChecking, createVideoThread, currentUser]);

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
          antMessage.warning("登录已过期，请重新登录");
          navigate("/app");
        } else {
          antMessage.error(errorText);
        }
        return false;
      } finally {
        setThreadRequestingBySession((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [appendAssistantMessage, fetchThreadStateOnce, navigate, startThreadStream, threadBySession, tryAppendThreadViewProgressChat]
  );

  const handleSubmitSingleSegmentEdit = useCallback(
    async (segment) => {
      const sid = Number(segment?.segment_id);
      if (!Number.isFinite(sid)) return;
      const value = (activeSegmentDraftMap[sid] ?? "").trim();
      if (!value) {
        antMessage.warning(`分镜 #${sid} 的描述不能为空`);
        return;
      }
      setSegmentSubmittingBySession((prev) => ({
        ...prev,
        [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: true },
      }));
      try {
        await resumeVideoThread(activeSessionId, {
          action: "edit",
          edited_segments: [{ segment_id: sid, description: value }],
          feedback: "",
        });
      } finally {
        setSegmentSubmittingBySession((prev) => ({
          ...prev,
          [activeSessionId]: { ...(prev[activeSessionId] || {}), [sid]: false },
        }));
      }
    },
    [activeSegmentDraftMap, activeSessionId, resumeVideoThread],
  );

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const sessionId = activeSessionId;
    setSending(true);
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
              title: s.title === "新对话" || s.title === "视频生成助手" ? text.slice(0, 18) + (text.length > 18 ? "…" : "") : s.title,
              updatedAt: Date.now(),
            }
          : s,
      ),
    );

    const payload = buildDraftCreatePayload(text);
    await createVideoThread(sessionId, payload);
    setSending(false);
  };

  const handleSendFixedRequest = async () => {
    const sessionId = activeSessionId;
    if (sending || activeThreadRequesting) return;
    appendMessages(sessionId, (list) => [
      ...list.map((m) => ({ ...m, suggestions: false })),
      { id: uid(), role: "user", content: "发送固定 create 请求（联调用）" },
    ]);
    await createVideoThread(sessionId, deepCloneJson(DEMO_CREATE_THREAD_PAYLOAD), "固定请求已发送");
  };

  const handleResumeApprove = async () => {
    await resumeVideoThread(activeSessionId, {
      action: "approve",
      edited_segments: [],
      feedback: "",
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
    });
    if (ok) setDraft("");
  };

  const handleResumeEdit = async () => {
    const segments = activeThreadView?.segments || [];
    if (!segments.length) {
      antMessage.warning("当前没有可编辑的分镜");
      return;
    }
    const editedSegments = segments
      .map((seg) => {
        const sid = Number(seg?.segment_id);
        if (!Number.isFinite(sid)) return null;
        const originalText =
          (typeof seg?.description === "string" && seg.description.trim()) ||
          (typeof seg?.description_en === "string" && seg.description_en.trim()) ||
          "";
        const draftText = (activeSegmentDraftMap[sid] ?? "").trim();
        if (!draftText || draftText === originalText) return null;
        return {
          segment_id: sid,
          description: draftText,
        };
      })
      .filter(Boolean);
    if (!editedSegments.length) {
      antMessage.info("请先在分镜清单里修改至少一条分镜内容");
      return;
    }
    await resumeVideoThread(activeSessionId, {
      action: "edit",
      edited_segments: editedSegments,
      feedback: "",
    });
  };

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

          <div className="video-chat-sidebar__section">
            {sidebarExpanded && (
              <div className="video-chat-sidebar__section-title">
                <CheckSquareOutlined /> 任务列表
              </div>
            )}
            <ul className="video-chat-task-list">
              {MOCK_TASKS.map((t) => (
                <li key={t.id} className={t.active ? "is-active" : ""} title={t.label}>
                  <span className="video-chat-task-dot" aria-hidden />
                  {sidebarExpanded && <span className="video-chat-task-label">{t.label}</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="video-chat-sidebar__section video-chat-sidebar__section--grow">
            {sidebarExpanded && (
              <div className="video-chat-sidebar__section-title">
                <HistoryOutlined /> 历史对话
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
                <Button type="primary" onClick={handleSendFixedRequest} loading={activeThreadRequesting} disabled={sending}>
                  发送固定请求
                </Button>
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
                  <div className="video-chat-msg__content">{m.content}</div>
                  {m.role === "assistant" && (
                    <div className="video-chat-msg__actions">
                      <button type="button" className="video-chat-msg__action" aria-label="复制" onClick={() => handleCopy(m.content)}>
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
          </div>

          <div className="video-chat-input-wrap">
            {activeSegments.length > 0 && (
              <div className="video-chat-segment-panel">
                <div className="video-chat-segment-panel__head">
                  <div className="video-chat-segment-panel__title">分镜清单</div>
                  <div className="video-chat-segment-panel__summary">{activeSegments.length} 条</div>
                </div>
                <div className="video-chat-segment-list">
                  {activeSegments
                    .slice()
                    .sort((a, b) => (Number(a?.segment_id) || 0) - (Number(b?.segment_id) || 0))
                    .map((seg) => {
                      const sid = Number(seg?.segment_id);
                      if (!Number.isFinite(sid)) return null;
                      const meta = getSegmentStatusMeta(activeThreadView?.status, activeTaskStatusMap[sid]);
                      const segmentVideoUrl = activeSegmentVideoUrlMap[sid] || "";
                      const draftValue =
                        activeSegmentDraftMap[sid] ??
                        (typeof seg?.description === "string" ? seg.description : seg?.description_en || "");
                      const segMeta = [
                        seg?.duration != null ? `${seg.duration}s` : null,
                        seg?.mode ? seg.mode : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div key={sid} className="video-chat-segment-item">
                          <div className="video-chat-segment-item__top">
                            <div className="video-chat-segment-item__title">分镜 #{sid}</div>
                            <span className={`video-chat-segment-item__status is-${meta.tone}`}>{meta.text}</span>
                          </div>
                          {segMeta && <div className="video-chat-segment-item__meta">{segMeta}</div>}
                          <Input.TextArea
                            value={draftValue}
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            className="video-chat-segment-item__textarea"
                            disabled={!activeWaitingHuman || activeThreadRequesting}
                            onChange={(e) => handleSegmentDraftChange(sid, e.target.value)}
                            placeholder="输入该分镜描述"
                          />
                          <div className="video-chat-segment-item__actions">
                            <Button
                              size="small"
                              onClick={() => handleSubmitSingleSegmentEdit(seg)}
                              loading={Boolean(activeSegmentSubmittingMap[sid])}
                              disabled={!activeWaitingHuman || activeThreadRequesting}
                            >
                              仅提交此条修改
                            </Button>
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
              </div>
            )}
            <div className="video-chat-input-card">
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
              <div className="video-chat-input-toolbar">
                <div className="video-chat-input-tools">
                  {INPUT_TOOLS.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        className={`video-chat-tool ${t.primary ? "video-chat-tool--primary" : ""}`}
                        onClick={() => {
                          if (t.key === "video") antMessage.info("视频生成模式（演示）");
                        }}
                      >
                        <Icon />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
                <Button
                  size="small"
                  type="default"
                  icon={<SettingOutlined />}
                  onClick={openParamModal}
                  className="video-chat-param-btn video-chat-param-btn--input"
                >
                  视频参数
                </Button>
                <button type="button" className="video-chat-mic" aria-label="语音输入">
                  <AudioOutlined />
                </button>
              </div>
            </div>
            <div className="video-chat-input-hint">
              Enter 发送 · 实时连接{wsConnected ? "已连接" : "未连接"} ·
              {activeThreadId ? ` 当前 thread: ${activeThreadId}` : " 尚未创建 thread"}
              {activeThreadView?.status ? ` · 状态: ${activeThreadView.status}` : ""}
            </div>
            {activeWaitingHuman && (
              <div className="video-chat-human-wrap">
                <div className="video-chat-human-actions">
                  <Button size="small" type="primary" onClick={handleResumeApprove} loading={activeThreadRequesting}>
                    通过并继续
                  </Button>
                  <Button size="small" onClick={handleResumeFeedback} loading={activeThreadRequesting}>
                    反馈重写
                  </Button>
                  <Button size="small" onClick={handleResumeEdit} loading={activeThreadRequesting}>
                    提交全部修改
                  </Button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

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
              onChange={(v) => setParamDraft((p) => ({ ...p, resolution: v }))}
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
              onChange={(v) => setParamDraft((p) => ({ ...p, ratio: v }))}
              options={RATIO_OPTIONS}
              style={{ width: "100%" }}
            />
          </div>

          <div className="video-chat-param-row video-chat-param-row--switch">
            <span className="video-chat-param-label">携带 AI 生成水印</span>
            <Switch checked={paramDraft.watermark} onChange={(v) => setParamDraft((p) => ({ ...p, watermark: v }))} />
          </div>

          <div className="video-chat-param-row video-chat-param-row--switch">
            <span className="video-chat-param-label">生成音频</span>
            <Switch checked={paramDraft.generateAudio} onChange={(v) => setParamDraft((p) => ({ ...p, generateAudio: v }))} />
          </div>

          <div className="video-chat-param-row">
            <span className="video-chat-param-label">返回文字语言</span>
            <Select
              value={paramDraft.responseLang}
              onChange={(v) => setParamDraft((p) => ({ ...p, responseLang: v }))}
              options={RESPONSE_LANG_OPTIONS}
              style={{ width: "100%" }}
            />
          </div>

          <div className="video-chat-param-block">
            <span className="video-chat-param-label video-chat-param-label--block">视频生成模式</span>
            <Radio.Group
              value={paramDraft.generationMode}
              onChange={(e) => setParamDraft((p) => ({ ...p, generationMode: e.target.value }))}
              className="video-chat-param-radio-group"
            >
              {GENERATION_MODE_OPTIONS.map((opt) => (
                <Radio key={opt.value} value={opt.value}>
                  {opt.label}
                </Radio>
              ))}
            </Radio.Group>
          </div>

          {paramDraft.generationMode === "reference_to_video" && (
            <div className="video-chat-param-block">
              <label className="video-chat-param-label video-chat-param-label--block" htmlFor="vp-ref-usage">
                参考图用途说明
              </label>
              <p className="video-chat-param-hint">支持 1～4 张参考图；请说明每张图的用途，例如：图1 产品主图，图2 场景氛围，图3 …</p>
              <Input.TextArea
                id="vp-ref-usage"
                rows={4}
                value={paramDraft.referenceUsageDescription}
                onChange={(e) => setParamDraft((p) => ({ ...p, referenceUsageDescription: e.target.value }))}
                placeholder="图1：…&#10;图2：…"
              />
            </div>
          )}

          {paramDraft.generationMode === "first_last_frame" && (
            <div className="video-chat-param-block">
              <span className="video-chat-param-label video-chat-param-label--block">首尾帧图片</span>
              <p className="video-chat-param-hint">至少上传首帧或尾帧之一；可同时上传两张以控制起止画面（仅本地预览，未上传服务器）。</p>
              <div className="video-chat-param-uploads">
                <div>
                  <div className="video-chat-param-upload-title">首帧</div>
                  <Upload
                    accept="image/*"
                    maxCount={1}
                    fileList={paramDraft.firstFrameList}
                    beforeUpload={() => false}
                    onChange={({ fileList }) => setParamDraft((p) => ({ ...p, firstFrameList: fileList.slice(-1) }))}
                    onRemove={() => setParamDraft((p) => ({ ...p, firstFrameList: [] }))}
                  >
                    <Button size="small">选择图片</Button>
                  </Upload>
                </div>
                <div>
                  <div className="video-chat-param-upload-title">尾帧</div>
                  <Upload
                    accept="image/*"
                    maxCount={1}
                    fileList={paramDraft.lastFrameList}
                    beforeUpload={() => false}
                    onChange={({ fileList }) => setParamDraft((p) => ({ ...p, lastFrameList: fileList.slice(-1) }))}
                    onRemove={() => setParamDraft((p) => ({ ...p, lastFrameList: [] }))}
                  >
                    <Button size="small">选择图片</Button>
                  </Upload>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
