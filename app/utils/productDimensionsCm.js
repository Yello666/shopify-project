/**
 * 商品尺寸：前端三列（长/宽/高，cm）与后端 size_description 字符串互转。
 * 存储格式：Length:30cm,Width:40cm,Height:50cm
 */

const RE_LENGTH = /Length:\s*([\d.]+)\s*cm/i;
const RE_WIDTH = /Width:\s*([\d.]+)\s*cm/i;
const RE_HEIGHT = /Height:\s*([\d.]+)\s*cm/i;

/**
 * @param {string|undefined|null} str
 * @returns {{ length_cm?: number, width_cm?: number, height_cm?: number }}
 */
export function parseProductSizeDescriptionCm(str) {
  const s = String(str ?? "").trim();
  if (!s) {
    return {};
  }
  const mL = RE_LENGTH.exec(s);
  const mW = RE_WIDTH.exec(s);
  const mH = RE_HEIGHT.exec(s);
  if (mL && mW && mH) {
    return {
      length_cm: Number(mL[1]),
      width_cm: Number(mW[1]),
      height_cm: Number(mH[1]),
    };
  }
  return {};
}

/**
 * @param {unknown} lengthCm
 * @param {unknown} widthCm
 * @param {unknown} heightCm
 * @returns {string|null} 三者齐全且合法时返回标准串，否则 null（表示清空或未填）
 */
export function formatProductSizeDescriptionCm(lengthCm, widthCm, heightCm) {
  const empty = (v) => v === undefined || v === null || v === "";
  if (empty(lengthCm) && empty(widthCm) && empty(heightCm)) {
    return null;
  }
  const l = Number(lengthCm);
  const w = Number(widthCm);
  const h = Number(heightCm);
  if (![l, w, h].every((n) => Number.isFinite(n) && n >= 0)) {
    return null;
  }
  return `Length:${l}cm,Width:${w}cm,Height:${h}cm`;
}

/** 详情页展示：能解析则友好展示，否则回退原文 */
export function formatSizeDescriptionForDisplay(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const { length_cm, width_cm, height_cm } = parseProductSizeDescriptionCm(s);
  if (
    length_cm != null &&
    width_cm != null &&
    height_cm != null &&
    Number.isFinite(length_cm) &&
    Number.isFinite(width_cm) &&
    Number.isFinite(height_cm)
  ) {
    return `长 ${length_cm} cm × 宽 ${width_cm} cm × 高 ${height_cm} cm`;
  }
  return s;
}

/** Ant Design Form 校验：要么全空，要么长宽高都填且为非负数 */
export function createProductSizeCmGroupRule() {
  return [
    ({ getFieldsValue }) => ({
      validator() {
        const { size_length_cm: L, size_width_cm: W, size_height_cm: H } = getFieldsValue(true);
        const triple = [L, W, H];
        const filled = triple.map((x) => x !== undefined && x !== null && x !== "");
        const any = filled.some(Boolean);
        if (!any) {
          return Promise.resolve();
        }
        if (!filled.every(Boolean)) {
          return Promise.reject(new Error("请同时填写长、宽、高（cm）"));
        }
        for (const x of triple) {
          const n = Number(x);
          if (!Number.isFinite(n) || n < 0) {
            return Promise.reject(new Error("长宽高须为大于等于 0 的数字（cm）"));
          }
        }
        return Promise.resolve();
      },
    }),
  ];
}
