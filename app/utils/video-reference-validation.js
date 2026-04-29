/**
 * 多模态参考素材校验（图片 / 视频 / 音频），与产品侧参数一致。
 */

export const REQ_BODY_MAX_BYTES = 64 * 1024 * 1024;

/** 说明弹窗结构化文案（按需与校验逻辑同步） */
export const REFERENCE_ASSETS_RULES_SECTIONS = [
  {
    title: "全局",
    bullets: ["JSON 请求体总大小不超过 64 MB。", "音视频大文件建议使用直传/OSS URL，请勿使用超大 Base64。"],
  },
  {
    title: "参考图片（多模态参考生视频可传 1～9 张）",
    bullets: [
      "格式：jpeg、png、webp、bmp、tiff、gif",
      "宽高比（宽/高）：(0.4, 2.5)，不含边界",
      "宽、高（px）：分别在 (300, 6000) 内（不含边界）",
      "单张图片：小于 30 MB",
      "请勿超过 9 张",
    ],
  },
  {
    title: "参考视频",
    bullets: [
      "容器格式：mp4、mov（编码请以接口文档表格为准，例如 H.264 / HEVC 等）",
      "分辨率档：较短边应为 480、720 或 1080 像素之一（对应 480p / 720p / 1080p）",
      "宽高比（宽/高）：[0.4, 2.5]",
      "宽、高（px）：各在 [300, 6000] 内；总像素宽×高在 [640×640, 2206×946]（即 [409600, 2086876]）",
      "单个视频时长：[2, 15] s；最多 3 段参考视频；所有参考视频时长之和 ≤ 15 s",
      "单文件：不超过 50 MB",
      "帧率 (FPS)：[24, 60]（浏览器无法可靠读取 FPS，请以实际导出素材为准）",
    ],
  },
  {
    title: "参考音频",
    bullets: [
      "格式：wav、mp3",
      "单个时长：[2, 15] s；最多 3 段参考音频；所有参考音频时长之和 ≤ 15 s",
      "单文件：不超过 15 MB",
    ],
  },
];

export function estimateJsonPayloadBytes(payload) {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function loadImageNaturalSize(blobUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("image-load"));
    img.src = blobUrl;
  });
}

/** @returns {Promise<{ duration: number, width: number, height: number }>} */
function loadVideoMetadata(blobUrl) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    const done = () => {
      cleanup();
      const d = Number(v.duration);
      const width = Number(v.videoWidth) || 0;
      const height = Number(v.videoHeight) || 0;
      resolve({ duration: Number.isFinite(d) ? d : 0, width, height });
    };
    const fail = () => {
      cleanup();
      reject(new Error("video-load"));
    };
    function cleanup() {
      v.removeEventListener("loadedmetadata", done);
      v.removeEventListener("error", fail);
    }
    v.addEventListener("loadedmetadata", done);
    v.addEventListener("error", fail);
    v.src = blobUrl;
  });
}

/** @returns {Promise<number>} */
function loadAudioDuration(blobUrl) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    const done = () => {
      cleanup();
      const d = Number(a.duration);
      resolve(Number.isFinite(d) ? d : 0);
    };
    const fail = () => {
      cleanup();
      reject(new Error("audio-load"));
    };
    function cleanup() {
      a.removeEventListener("loadedmetadata", done);
      a.removeEventListener("error", fail);
    }
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", done);
    a.addEventListener("error", fail);
    a.src = blobUrl;
  });
}

const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|tiff?|gif)$/i;
const VIDEO_EXT = /\.(mp4|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav)$/i;

const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;

const IMG_RATIO_MIN = 0.4;
const IMG_RATIO_MAX = 2.5;
const IMG_DIM_MIN = 300;
const IMG_DIM_MAX = 6000;

const VID_RATIO_MIN = 0.4;
const VID_RATIO_MAX = 2.5;
const VID_DIM_MIN = 300;
const VID_DIM_MAX = 6000;
const VID_PIXEL_MIN = 409600;
const VID_PIXEL_MAX = 2086876;
const VID_DURATION_MIN = 2;
const VID_DURATION_MAX = 15;
const VID_MAX_COUNT = 3;
const VID_TOTAL_MAX = 15;
const ALLOWED_SHORT_SIDES = new Set([480, 720, 1080]);

const AUD_DURATION_MIN = 2;
const AUD_DURATION_MAX = 15;
const AUD_MAX_COUNT = 3;
const AUD_TOTAL_MAX = 15;

const REF_IMAGE_MIN = 1;
const REF_IMAGE_MAX = 9;

/**
 * 将文件归类到 images / audios / videos；不符合扩展名白名单则返回 null。
 * @returns {"images"|"audios"|"videos"|null}
 */
export function classifyReferenceFileStrict(file) {
  const n = (file.name || "").toLowerCase();
  if (IMAGE_EXT.test(n)) return "images";
  if (AUDIO_EXT.test(n)) return "audios";
  if (VIDEO_EXT.test(n)) return "videos";
  const t = (file.type || "").trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/png" || t === "image/webp" || t === "image/bmp" || t === "image/gif" || t === "image/tiff")
    return "images";
  if (t === "audio/mpeg" || t === "audio/wav" || t === "audio/wave" || t === "audio/x-wav" || t === "audio/mp3")
    return "audios";
  if (t === "video/mp4" || t === "video/quicktime") return "videos";
  return null;
}

/**
 * @param {File} file
 * @param {string} blobUrl
 * @returns {Promise<{ ok: boolean, errors: string[], meta?: { width: number, height: number } }>}
 */
export async function validateImageFile(file, blobUrl) {
  const errors = [];
  const mt = (file.type || "").trim().toLowerCase();
  const extOk = IMAGE_EXT.test(file.name || "");
  const mimeOk =
    mt === "image/jpeg" ||
    mt === "image/png" ||
    mt === "image/webp" ||
    mt === "image/bmp" ||
    mt === "image/gif" ||
    mt === "image/tiff";
  if (!extOk && !mimeOk) {
    errors.push(`「${file.name}」：仅支持 jpeg、png、webp、bmp、tiff、gif`);
  }
  if (file.size >= IMAGE_MAX_BYTES) {
    errors.push(`「${file.name}」：单张图片须小于 30 MB`);
  }
  let width = 0;
  let height = 0;
  try {
    const dim = await loadImageNaturalSize(blobUrl);
    width = dim.width;
    height = dim.height;
  } catch {
    return { ok: false, errors: [`「${file.name}」：无法读取图片尺寸，请检查文件是否损坏`] };
  }
  if (width <= 0 || height <= 0) {
    errors.push(`「${file.name}」：图片宽高无效`);
  }
  const ratio = width / height;
  if (ratio <= IMG_RATIO_MIN || ratio >= IMG_RATIO_MAX) {
    errors.push(
      `「${file.name}」：宽高比（宽/高）须在 (0.4, 2.5) 内，当前约 ${ratio.toFixed(4)}`,
    );
  }
  if (width <= IMG_DIM_MIN || width >= IMG_DIM_MAX || height <= IMG_DIM_MIN || height >= IMG_DIM_MAX) {
    errors.push(
      `「${file.name}」：宽、高（px）须分别在 (300, 6000) 内，当前 ${width}×${height}`,
    );
  }
  return {
    ok: errors.length === 0,
    errors,
    meta: { width, height },
  };
}

/**
 * @param {File} file
 * @param {string} blobUrl
 */
export async function validateVideoFile(file, blobUrl) {
  const errors = [];
  const mt = (file.type || "").trim().toLowerCase();
  const extOk = VIDEO_EXT.test(file.name || "");
  const mimeOk = mt === "video/mp4" || mt === "video/quicktime";
  if (!extOk && !mimeOk) {
    errors.push(`「${file.name}」：视频仅支持 mp4、mov`);
  }
  if (file.size > VIDEO_MAX_BYTES) {
    errors.push(`「${file.name}」：单个视频须不超过 50 MB`);
  }
  let width = 0;
  let height = 0;
  let duration = 0;
  try {
    const meta = await loadVideoMetadata(blobUrl);
    width = meta.width;
    height = meta.height;
    duration = meta.duration;
  } catch {
    return { ok: false, errors: [`「${file.name}」：无法读取视频信息，请检查文件是否损坏`] };
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push(`「${file.name}」：无法读取有效时长`);
  } else if (duration < VID_DURATION_MIN || duration > VID_DURATION_MAX) {
    errors.push(`「${file.name}」：单个视频时长须在 [2, 15] 秒内（当前约 ${duration.toFixed(2)} s）`);
  }
  if (width <= 0 || height <= 0) {
    errors.push(`「${file.name}」：无法读取有效分辨率`);
  } else {
    const shortSide = Math.min(width, height);
    if (!ALLOWED_SHORT_SIDES.has(shortSide)) {
      errors.push(
        `「${file.name}」：较短边应为 480、720 或 1080 像素（对应 480p/720p/1080p），当前较短边 ${shortSide}，分辨率 ${width}×${height}`,
      );
    }
    const ratio = width / height;
    if (ratio < VID_RATIO_MIN || ratio > VID_RATIO_MAX) {
      errors.push(`「${file.name}」：宽高比（宽/高）须在 [0.4, 2.5] 内，当前约 ${ratio.toFixed(4)}`);
    }
    if (width < VID_DIM_MIN || width > VID_DIM_MAX || height < VID_DIM_MIN || height > VID_DIM_MAX) {
      errors.push(`「${file.name}」：宽、高（px）须各在 [300, 6000] 内，当前 ${width}×${height}`);
    }
    const pixels = width * height;
    if (pixels < VID_PIXEL_MIN || pixels > VID_PIXEL_MAX) {
      errors.push(
        `「${file.name}」：总像素须在 [409600, 2086876] 内（宽×高），当前 ${pixels}`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    meta: { width, height, duration },
  };
}

/** @param {File} file @param {string} blobUrl */
export async function validateAudioFile(file, blobUrl) {
  const errors = [];
  const mt = (file.type || "").trim().toLowerCase();
  const extOk = AUDIO_EXT.test(file.name || "");
  const mimeOk =
    mt === "audio/mpeg" ||
    mt === "audio/mp3" ||
    mt === "audio/wav" ||
    mt === "audio/wave" ||
    mt === "audio/x-wav";
  if (!extOk && !mimeOk) {
    errors.push(`「${file.name}」：音频仅支持 wav、mp3`);
  }
  if (file.size > AUDIO_MAX_BYTES) {
    errors.push(`「${file.name}」：单个音频须不超过 15 MB`);
  }
  let duration = 0;
  try {
    duration = await loadAudioDuration(blobUrl);
  } catch {
    return { ok: false, errors: [`「${file.name}」：无法读取音频时长`] };
  }
  if (duration < AUD_DURATION_MIN || duration > AUD_DURATION_MAX) {
    errors.push(`「${file.name}」：单个音频时长须在 [2, 15] 秒内（当前约 ${duration.toFixed(2)} s）`);
  }
  return {
    ok: errors.length === 0,
    errors,
    meta: { duration },
  };
}

/**
 * 单文件校验 + 生成 dataUrl + meta（先 createObjectURL 做元数据，再读 dataUrl）
 * @returns {Promise<{ ok: boolean, errors: string[], entry?: { file: File, dataUrl: string, meta: object } }>}
 */
export async function validateReferenceFileAndRead(file, bucket) {
  const blobUrl = URL.createObjectURL(file);
  try {
    if (bucket === "images") {
      const r = await validateImageFile(file, blobUrl);
      if (!r.ok) return { ok: false, errors: r.errors };
      const dataUrl = await readFileAsDataURL(file);
      return { ok: true, errors: [], entry: { file, dataUrl, meta: r.meta } };
    }
    if (bucket === "videos") {
      const r = await validateVideoFile(file, blobUrl);
      if (!r.ok) return { ok: false, errors: r.errors };
      const dataUrl = await readFileAsDataURL(file);
      return { ok: true, errors: [], entry: { file, dataUrl, meta: r.meta } };
    }
    if (bucket === "audios") {
      const r = await validateAudioFile(file, blobUrl);
      if (!r.ok) return { ok: false, errors: r.errors };
      const dataUrl = await readFileAsDataURL(file);
      return { ok: true, errors: [], entry: { file, dataUrl, meta: r.meta } };
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

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

/**
 * 聚合校验（数量、总时长、图片张数）
 * @param {{ images: any[], audios: any[], videos: any[] }} pending
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateReferenceAggregates(pending) {
  const errors = [];
  const { images = [], audios = [], videos = [] } = pending || {};
  const nImg = images.length;
  const nAud = audios.length;
  const nVid = videos.length;

  if (nImg > 0 && (nImg < REF_IMAGE_MIN || nImg > REF_IMAGE_MAX)) {
    errors.push(`参考图片须为 1～9 张，当前 ${nImg} 张`);
  }
  if (nVid > VID_MAX_COUNT) {
    errors.push(`参考视频最多 ${VID_MAX_COUNT} 个，当前 ${nVid} 个`);
  }
  if (nAud > AUD_MAX_COUNT) {
    errors.push(`参考音频最多 ${AUD_MAX_COUNT} 段，当前 ${nAud} 段`);
  }

  const vidDurSum = videos.reduce((s, x) => s + (Number(x.meta?.duration) || 0), 0);
  if (nVid > 0 && vidDurSum > VID_TOTAL_MAX + 1e-6) {
    errors.push(`参考视频总时长须 ≤ ${VID_TOTAL_MAX} s，当前合计约 ${vidDurSum.toFixed(2)} s`);
  }
  const audDurSum = audios.reduce((s, x) => s + (Number(x.meta?.duration) || 0), 0);
  if (nAud > 0 && audDurSum > AUD_TOTAL_MAX + 1e-6) {
    errors.push(`参考音频总时长须 ≤ ${AUD_TOTAL_MAX} s，当前合计约 ${audDurSum.toFixed(2)} s`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateRequestBodyUnderLimit(payload, maxBytes = REQ_BODY_MAX_BYTES) {
  const n = estimateJsonPayloadBytes(payload);
  if (n <= maxBytes) return { ok: true, errors: [], byteLength: n };
  return {
    ok: false,
    errors: [
      `JSON 请求体约 ${formatMb(n)}，超过上限 ${formatMb(maxBytes)}。请减少参考素材或改用 URL 直传。`,
    ],
    byteLength: n,
  };
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
