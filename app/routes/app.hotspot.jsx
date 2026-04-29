import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Space, Spin, Empty, message, Modal, InputNumber, Switch, Select } from "antd";
import { authFetch } from "../utils/auth-api";

const PAGE_SIZE = 10;
const DEFAULT_MIN_COMPATIBILITY_SCORE = 60;
const DEFAULT_SCHEDULE_STATE = {
  configured: false,
  id: null,
  merchant_id: null,
  is_enabled: false,
  mode: "interval_from_now",
  min_compatibility_score: DEFAULT_MIN_COMPATIBILITY_SCORE,
  send_hour: 9,
  send_minute: 0,
  timezone: "Asia/Shanghai",
  interval_hours: 24,
  last_sent_at: null,
  last_triggered_at: null,
};

const SCHEDULE_MODE_OPTIONS = [
  { label: "从当前时刻开始按间隔触发（interval_from_now）", value: "interval_from_now" },
  { label: "每日固定时间触发（daily_fixed）", value: "daily_fixed" },
  { label: "固定时间窗口 + 间隔触发（interval_from_fixed）", value: "interval_from_fixed" },
];

function pickResponseData(json) {
  return json?.data && typeof json.data === "object" ? json.data : json;
}

function normalizeMinCompatibilityScore(raw, fallback = DEFAULT_MIN_COMPATIBILITY_SCORE) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// 根据 GET /recommend-email/schedule 返回的锚点与间隔，在打开页面时静态推算「下一次可开始尝试调度」的参考时间（非任务完成时间）
function describeNextScheduleAttemptLine(scheduleState, { loading }) {
  if (loading) return "正在加载定时推荐信息…";
  if (!scheduleState?.is_enabled) {
    return "定时推荐未开启。开启并保存后，本页会按当前 mode 静态展示一次下一次尝试调度提示（不自动刷新）。";
  }
  const mode = scheduleState?.mode || "interval_from_now";
  if (mode === "daily_fixed") {
    const hour = Number(scheduleState.send_hour);
    const minute = Number(scheduleState.send_minute);
    const hh = Number.isFinite(hour) ? String(Math.max(0, Math.min(23, hour))).padStart(2, "0") : "09";
    const mm = Number.isFinite(minute) ? String(Math.max(0, Math.min(59, minute))).padStart(2, "0") : "00";
    return `当前模式：每日固定时间。预计每天 ${hh}:${mm} 开始尝试调度（打开页面时静态提示，非任务完成时间）。`;
  }

  if (mode === "interval_from_fixed") {
    const hour = Number(scheduleState.send_hour);
    const minute = Number(scheduleState.send_minute);
    const hh = Number.isFinite(hour) ? String(Math.max(0, Math.min(23, hour))).padStart(2, "0") : "09";
    const mm = Number.isFinite(minute) ? String(Math.max(0, Math.min(59, minute))).padStart(2, "0") : "00";
    const hours = Number(scheduleState.interval_hours);
    const intervalH = Number.isFinite(hours) && hours > 0 ? hours : 24;
    return `当前模式：固定时间窗口 + 间隔。将在每日 ${hh}:${mm} 窗口检查，且两次成功发送至少间隔 ${intervalH} 小时（静态提示，非任务完成时间）。`;
  }

  const rawLast = scheduleState?.last_sent_at;
  if (!rawLast) {
    return "定时推荐已开启，但缺少锚点时间字段：保存一次配置后，即可根据「上次锚点/发送时间 + 间隔」推算。";
  }
  const last = new Date(rawLast);
  if (Number.isNaN(last.getTime())) {
    return "无法解析锚点时间，暂无法推算下一次尝试调度时间。";
  }
  const hours = Number(scheduleState.interval_hours);
  const intervalH = Number.isFinite(hours) && hours > 0 ? hours : 24;
  const nextMs = last.getTime() + intervalH * 3600 * 1000;
  const next = new Date(nextMs);
  const tz = scheduleState.timezone || "Asia/Shanghai";
  const nextStr = next.toLocaleString("zh-CN", { hour12: false, timeZone: tz });
  if (nextMs <= Date.now()) {
    return "按当前间隔已到尝试条件：后端约每分钟检查一次，预计在约 1 分钟内开始尝试调度（仅供参考，非任务完成时间）。";
  }
  return `预计下一次开始尝试调度：${nextStr}（打开页面时的静态推算，调度器约每分钟检查一次，非任务完成时间）`;
}

// 与后端 RiskEnum（hotspot.py）及 collect_hostspot 风控说明一致；占位句与后端写入的 warning 一致，用于隐藏原文链接
const HOTSPOT_PLACEHOLDER_NO_MORE_INFO = "暂无更多信息，建议前往平台进行搜索。";

const RISK_CATEGORY_DISPLAY = {
  RED_LINE: {
    dotClass: "hotspot-risk-dot--red",
    labelZh: "敏感或违规内容",
  },
  YELLOW_OPPORTUNITY: {
    dotClass: "hotspot-risk-dot--yellow",
    labelZh: "高商业潜力但需谨慎评估舆论与表述",
  },
  GREEN_SAFE: {
    dotClass: "hotspot-risk-dot--green",
    labelZh: "低风险",
  },
};

// 将 risk_category 转为列表展示用的圆点样式类与中文说明（未知枚举值走兜底文案）
function getRiskCategoryDisplay(riskCategory) {
  if (riskCategory == null || riskCategory === "" || riskCategory === "NONE") return null;
  const key = String(riskCategory).trim();
  const found = RISK_CATEGORY_DISPLAY[key];
  if (found) return { ...found, code: key };
  return {
    dotClass: "hotspot-risk-dot--unknown",
    labelZh: `未识别风险类型（${key}）`,
    code: key,
  };
}

// 把推荐接口返回的 { trend, match } 合并成与分页热点列表同一形状的一行数据，便于复用 HotspotItem
function flattenRecommendedItem(raw) {
  const trend = raw?.trend && typeof raw.trend === "object" ? raw.trend : raw;
  const match = raw?.match && typeof raw.match === "object" ? raw.match : null;
  const rec = match?.recommendation;
  const recommendationLabel =
    typeof rec === "string" ? rec : rec != null && typeof rec === "object" && "value" in rec ? String(rec.value) : "";

  return {
    ...trend,
    match_score: match?.compatibility_score ?? trend.match_score,
    recommend_reason: match?.reason ?? "",
    recommend_level: recommendationLabel || "",
    marketing_suggestion: match?.suggestion ?? "",
  };
}

// 将标签数组格式化为列表副标题展示用的一行字符串
function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return tags.join(" · ");
}

// 将受众数组格式化为扩展信息区展示用的一行字符串
function formatAudience(audience) {
  if (!Array.isArray(audience) || audience.length === 0) return "";
  return audience.join("、");
}

// 从行数据解析契合度/匹配分数值，供排序与匹配分颜色分档使用；无效时返回 null
function parseMatchScoreNumber(item) {
  const raw = item?.match_score ?? item?.matchScore;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && raw.trim() !== "—") {
    const n = Number.parseFloat(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function matchScoreToneClass(score) {
  if (score == null || Number.isNaN(score)) return "hotspot-match-score--none";
  if (score < 40) return "hotspot-match-score--low";
  if (score < 60) return "hotspot-match-score--mid";
  if (score < 80) return "hotspot-match-score--good";
  return "hotspot-match-score--high";
}

// 生成列表行的 React key，排序后保持不变；优先 id，避免勾选状态错乱
function hotspotRowKey(item) {
  if (item?.id != null && String(item.id).trim() !== "") return String(item.id);
  return `${item.title ?? ""}|${item.publish_time ?? ""}|${item.platform ?? ""}|${item.jump_url ?? ""}`;
}

// eslint-disable-next-line react/prop-types
function HotspotItem({
  item = {},
  index,
  itemKey,
  checked,
  onToggleSelect,
  recommendationMode,
}) {
  const [sentimentExplainOpen, setSentimentExplainOpen] = useState(false);
  const tagsStr = formatTags(item.tags);
  const audienceStr = formatAudience(item.audience);
  const matchScoreRaw = item.match_score ?? item.matchScore;
  const scoreNumeric = parseMatchScoreNumber(item);
  const matchScore =
    scoreNumeric != null
      ? `${Math.round(scoreNumeric)}`
      : typeof matchScoreRaw === "string" && matchScoreRaw.trim()
      ? matchScoreRaw.trim()
      : "—";
  const scoreToneClass = matchScoreToneClass(scoreNumeric);
  const recommendationReason =
    typeof item.recommend_reason === "string" && item.recommend_reason.trim()
      ? item.recommend_reason.trim()
      : "暂无推荐原因";
  const recommendationLevel =
    typeof item.recommend_level === "string" && item.recommend_level.trim()
      ? item.recommend_level.trim()
      : "—";
  const marketingSuggestion =
    typeof item.marketing_suggestion === "string" && item.marketing_suggestion.trim()
      ? item.marketing_suggestion.trim()
      : "—";
  const viewsLikes = [
    item.view_count != null ? `${item.view_count} 浏览` : null,
    item.likes != null ? `${item.likes} 赞` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const riskDisplay = getRiskCategoryDisplay(item.risk_category);

  const warningText = typeof item.warning_message === "string" ? item.warning_message.trim() : "";
  const hideOriginalLink =
    Boolean(warningText) && warningText.includes(HOTSPOT_PLACEHOLDER_NO_MORE_INFO);

  const warningLine = typeof item.warning_message === "string" ? item.warning_message.trim() : "";
  const hasSentimentScore = item.sentiment_score != null && item.sentiment_score !== 0;
  const audienceLine = audienceStr ? `受众：${audienceStr}` : "";
  const showOriginalLink = Boolean(item.jump_url) && !hideOriginalLink;
  const hasExtra = Boolean(warningLine) || Boolean(audienceLine) || hasSentimentScore || showOriginalLink;

  return (
    <div className="hotspot-table-body-group">
      <div
        className={`hotspot-table-row ${index % 2 === 1 ? "hotspot-table-row--alt" : ""}`}
        role="row"
      >
        <div
          className="hotspot-table-row__select-cell"
          style={{
            width: "28px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: recommendationMode ? "0.45rem" : 0,
          }}
        >
          {recommendationMode ? (
            <span
              className={`hotspot-match-score ${scoreToneClass}`}
              aria-label={`匹配分数 ${matchScore}`}
            >
              {matchScore}
            </span>
          ) : null}
          {!recommendationMode ? (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleSelect(itemKey, item)}
              aria-label={`选择热点：${item.title || "未命名热点"}`}
            />
          ) : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--title">
          <span className="hotspot-table-row__title">{item.title || "—"}</span>
          {tagsStr ? (
            <span className="hotspot-table-row__sub">标签：{tagsStr}</span>
          ) : null}
          {riskDisplay ? (
            <div className="hotspot-risk-inline" title={`风险等级：${riskDisplay.code}`}>
              <span className={`hotspot-risk-dot ${riskDisplay.dotClass}`} aria-hidden />
              <span className="hotspot-risk-label">{riskDisplay.labelZh}</span>
            </div>
          ) : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--summary">
          <span className="hotspot-table-row__text">{item.summary || "—"}</span>
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--meta">
          <span>{item.platform || "—"}</span>
          <span className="hotspot-table-row__sub">{item.publish_time || "—"}</span>
          {item.sentiment_label ? (
            <span className="hotspot-table-row__sub">{item.sentiment_label}</span>
          ) : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--action">
          <span className="hotspot-table-row__text">{viewsLikes || "—"}</span>
        </div>
      </div>
      {recommendationMode ? (
        <div
          className={`hotspot-table-row-extra hotspot-table-row-extra--recommend ${
            index % 2 === 1 ? "hotspot-table-row--alt" : ""
          }`}
        >
          <div className="hotspot-recommend-layout">
            <input
              className="hotspot-recommend-checkbox"
              type="radio"
              name="hotspot-recommend-radio"
              checked={checked}
              onChange={() => onToggleSelect(itemKey, item)}
              aria-label={`选择热点：${item.title || "未命名热点"}`}
            />
            <div className="hotspot-recommend-grid">
              <p>
                <strong>推荐原因：</strong>
                {recommendationReason}
              </p>
              <p>
                <strong>推荐等级：</strong>
                {recommendationLevel}
              </p>
              <p>
                <strong>营销建议：</strong>
                {marketingSuggestion}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {hasExtra ? (
        <div
          className={`hotspot-table-row-extra hotspot-table-row-extra--details ${
            index % 2 === 1 ? "hotspot-table-row--alt" : ""
          }`}
        >
          {warningLine ? <div>{warningLine}</div> : null}
          {audienceLine ? <div style={{ marginTop: warningLine ? "0.35rem" : 0 }}>{audienceLine}</div> : null}
          {hasSentimentScore ? (
            <div style={{ marginTop: warningLine || audienceLine ? "0.35rem" : 0 }}>
              <span>情感分：{item.sentiment_score}</span>
              <button
                type="button"
                onClick={() => setSentimentExplainOpen((prev) => !prev)}
                aria-label={sentimentExplainOpen ? "收起情感分解释" : "展开情感分解释"}
                style={{
                  marginLeft: 8,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: "1px solid var(--dash-border)",
                  background: "transparent",
                  color: "var(--dash-muted)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                ?
              </button>
              {sentimentExplainOpen ? (
                <div style={{ marginTop: 6, color: "var(--dash-muted)", fontSize: "0.875rem" }}>
                  情感分是热点的情感倾向，越靠近100情感越积极，越靠近-100情感越消极。
                </div>
              ) : null}
            </div>
          ) : null}
          {showOriginalLink ? (
            <div style={{ marginTop: warningLine || audienceLine || hasSentimentScore ? "0.35rem" : 0 }}>
              <a href={item.jump_url} target="_blank" rel="noopener noreferrer">
                查看原文链接
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch {
    // 未登录或网络异常时允许页面降级渲染
  }
  return null;
};

export default function Hotspot() {
  const navigate = useNavigate();
  const [hotspots, setHotspots] = useState([]);
  const [selectedHotspots, setSelectedHotspots] = useState({});
  const [recommendationMode, setRecommendationMode] = useState(false);
  const [recommendModalOpen, setRecommendModalOpen] = useState(false);
  const [recommendMinScore, setRecommendMinScore] = useState(DEFAULT_MIN_COMPATIBILITY_SCORE);
  const [recommendSubmitting, setRecommendSubmitting] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleState, setScheduleState] = useState(DEFAULT_SCHEDULE_STATE);
  const [scheduleDraft, setScheduleDraft] = useState({
    is_enabled: false,
    mode: "interval_from_now",
    min_compatibility_score: DEFAULT_MIN_COMPATIBILITY_SCORE,
    send_hour: 9,
    send_minute: 0,
    timezone: "Asia/Shanghai",
    interval_hours: 24,
  });
  const [isRecommendList, setIsRecommendList] = useState(false);
  /** null=列表原始顺序；desc/asc=按匹配分纯前端排序 */
  const [scoreSortOrder, setScoreSortOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const sentinelRef = useRef(null);

  const loadHotspotPage = useCallback(async (page, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(null);
      setReachedEnd(false);
    }

    try {
      const res = await authFetch("/api/v1/hotspot/hot-trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platforms: ["youtube"],
          page,
          page_size: PAGE_SIZE,
        }),
      });
      if (!res.ok) {
        throw new Error(`请求失败: ${res.status}`);
      }
      const data = await res.json();
      const payload =
        data?.data && typeof data.data === "object" ? data.data : data;
      const list = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload)
        ? payload
        : [];
      const responsePage = Number(payload?.page || page);
      const responseTotalPages = Math.max(1, Number(payload?.total_pages || 1));

      setCurrentPage(responsePage);
      setTotalPages(responseTotalPages);
      setReachedEnd(responsePage >= responseTotalPages || list.length === 0);
      setHotspots((prev) => (append ? [...prev, ...list] : list));
      if (!append) {
        setIsRecommendList(false);
        setScoreSortOrder(null);
      }
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("请先登录");
        navigate("/app");
        return;
      }
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [navigate]);

  const loadRecommendScheduleState = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const res = await authFetch("/api/v1/hotspot/recommend-email/schedule");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail ?? json?.message;
        throw new Error(typeof detail === "string" ? detail : `请求失败: ${res.status}`);
      }
      const data = { ...DEFAULT_SCHEDULE_STATE, ...pickResponseData(json) };
      setScheduleState(data);
      setScheduleDraft({
        is_enabled: Boolean(data.is_enabled),
        mode: data.mode || "interval_from_now",
        min_compatibility_score: normalizeMinCompatibilityScore(data.min_compatibility_score),
        send_hour: Number(data.send_hour ?? DEFAULT_SCHEDULE_STATE.send_hour),
        send_minute: Number(data.send_minute ?? DEFAULT_SCHEDULE_STATE.send_minute),
        timezone: data.timezone || DEFAULT_SCHEDULE_STATE.timezone,
        interval_hours: Number(data.interval_hours) || 24,
      });
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("请先登录");
        navigate("/app");
        return;
      }
      message.error(err?.message || "读取定时推荐配置失败");
    } finally {
      setScheduleLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadHotspotPage(1, false);
  }, [loadHotspotPage]);

  useEffect(() => {
    loadRecommendScheduleState();
  }, [loadRecommendScheduleState]);

  useEffect(() => {
    if (loading || loadingMore || error || isRecommendList) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;

        if (currentPage < totalPages) {
          loadHotspotPage(currentPage + 1, true);
          return;
        }

        setReachedEnd(true);
        observer.disconnect();
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [currentPage, error, isRecommendList, loading, loadingMore, loadHotspotPage, totalPages]);

  // 打开「品牌推荐热点」弹窗，用于编辑最低契合度并触发推荐接口
  const openRecommendModal = () => {
    setRecommendModalOpen(true);
  };

  const openScheduleModal = () => {
    setScheduleDraft({
      is_enabled: Boolean(scheduleState.is_enabled),
      mode: scheduleState.mode || "interval_from_now",
      min_compatibility_score: normalizeMinCompatibilityScore(scheduleState.min_compatibility_score),
      send_hour: Number(scheduleState.send_hour ?? DEFAULT_SCHEDULE_STATE.send_hour),
      send_minute: Number(scheduleState.send_minute ?? DEFAULT_SCHEDULE_STATE.send_minute),
      timezone: scheduleState.timezone || DEFAULT_SCHEDULE_STATE.timezone,
      interval_hours: Number(scheduleState.interval_hours) || 24,
    });
    setScheduleModalOpen(true);
  };

  // 调用 POST /hotspot/recommend，用返回列表替换当前热点并进入推荐展开视图（纯服务端筛选）
  const handleStartRecommend = async () => {
    const minScore = Number(recommendMinScore);
    if (!Number.isFinite(minScore)) {
      message.warning("请先填写最低契合度分数");
      return;
    }
    setRecommendSubmitting(true);
    try {
      const res = await authFetch("/api/v1/hotspot/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_compatibility_score: minScore,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.detail ?? data?.message;
        throw new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `请求失败: ${res.status}`);
      }
      const envelope = pickResponseData(data);
      const rawItems = Array.isArray(envelope?.items) ? envelope.items : [];
      const mapped = rawItems.map(flattenRecommendedItem);
      setHotspots(mapped);
      setSelectedHotspots({});
      setCurrentPage(1);
      setTotalPages(1);
      setReachedEnd(true);
      setIsRecommendList(true);
      setRecommendationMode(true);
      setScoreSortOrder(null);
      setRecommendModalOpen(false);
      const appliedMin = Number(envelope?.min_compatibility_score);
      if (Number.isFinite(appliedMin)) {
        setRecommendMinScore(appliedMin);
      }
      message.success(
        mapped.length
          ? `已加载 ${mapped.length} 条推荐热点（已分析 ${envelope?.analyzed_count ?? "?"} 条）`
          : "暂无达到阈值的推荐热点，可调低契合度后重试",
      );
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("请先登录");
        navigate("/app");
        return;
      }
      message.error(err?.message || "推荐失败");
    } finally {
      setRecommendSubmitting(false);
    }
  };

  const handleConfirmStartRecommend = () => {
    if (recommendSubmitting) return;
    Modal.confirm({
      title: "开始推荐前提示",
      content: "计算匹配度可能耗时较长，请不要退出页面，耐心等候",
      okText: "确认开始",
      cancelText: "取消",
      onOk: handleStartRecommend,
    });
  };

  const handleSaveSchedule = async () => {
    setScheduleSubmitting(true);
    try {
      const body = {
        is_enabled: Boolean(scheduleDraft.is_enabled),
        mode: scheduleDraft.mode || "interval_from_now",
        min_compatibility_score: Number(scheduleDraft.min_compatibility_score),
        interval_hours: Number(scheduleDraft.interval_hours),
        send_hour: Number(scheduleDraft.send_hour ?? DEFAULT_SCHEDULE_STATE.send_hour),
        send_minute: Number(scheduleDraft.send_minute ?? DEFAULT_SCHEDULE_STATE.send_minute),
        timezone: scheduleDraft.timezone || DEFAULT_SCHEDULE_STATE.timezone,
      };

      const res = await authFetch("/api/v1/hotspot/recommend-email/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail ?? json?.message;
        throw new Error(typeof detail === "string" ? detail : `请求失败: ${res.status}`);
      }

      const saved = { ...scheduleState, ...pickResponseData(json), configured: true };
      setScheduleState(saved);
      setScheduleDraft({
        is_enabled: Boolean(saved.is_enabled),
        mode: saved.mode || "interval_from_now",
        min_compatibility_score: normalizeMinCompatibilityScore(saved.min_compatibility_score),
        send_hour: Number(saved.send_hour ?? DEFAULT_SCHEDULE_STATE.send_hour),
        send_minute: Number(saved.send_minute ?? DEFAULT_SCHEDULE_STATE.send_minute),
        timezone: saved.timezone || DEFAULT_SCHEDULE_STATE.timezone,
        interval_hours: Number(saved.interval_hours) || 24,
      });
      setScheduleModalOpen(false);
      setRecommendMinScore(normalizeMinCompatibilityScore(saved.min_compatibility_score));
      message.success(saved.is_enabled ? "已开启定时推荐任务" : "已关闭定时推荐任务");
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("请先登录");
        navigate("/app");
        return;
      }
      message.error(err?.message || "保存定时推荐配置失败");
    } finally {
      setScheduleSubmitting(false);
    }
  };

  const handleToggleSelect = (itemKey, hotspot) => {
    if (recommendationMode) {
      setSelectedHotspots((prev) =>
        prev[itemKey] ? {} : { [itemKey]: hotspot },
      );
    } else {
      setSelectedHotspots((prev) => {
        if (prev[itemKey]) {
          const next = { ...prev };
          delete next[itemKey];
          return next;
        }
        return { ...prev, [itemKey]: hotspot };
      });
    }
  };

  // 按匹配分对当前 hotspots 做纯前端排序展示；未选择排序时与原数组顺序一致
  const displayHotspots = useMemo(() => {
    if (!scoreSortOrder) return hotspots;
    const copy = [...hotspots];
    // 无分数时按 -1 参与排序，保证无分条目排在有分之后（与 desc/asc 一致）
    const scoreOf = (it) => {
      const n = parseMatchScoreNumber(it);
      return n == null ? -1 : n;
    };
    copy.sort((a, b) => {
      const da = scoreOf(a);
      const db = scoreOf(b);
      if (scoreSortOrder === "desc") return db - da;
      return da - db;
    });
    return copy;
  }, [hotspots, scoreSortOrder]);

  // 切换匹配分排序：高→低 → 低→高 → 恢复默认顺序（不请求后端）
  const cycleScoreSort = () => {
    setScoreSortOrder((prev) => {
      if (prev == null) return "desc";
      if (prev === "desc") return "asc";
      return null;
    });
  };

  const handleGenerate = () => {
    const selectedList = Object.values(selectedHotspots);
    if (selectedList.length === 0) {
      message.warning(recommendationMode ? "请先选择一个热点" : "请先勾选至少一个热点");
      return;
    }
    if (recommendationMode) {
      const hotspot = selectedList[0];
      const encoded = encodeURIComponent(JSON.stringify(hotspot));
      navigate(`/app/generate?hotspot=${encoded}`);
    } else {
      const encoded = encodeURIComponent(JSON.stringify(selectedList));
      navigate(`/app/match?hotspots=${encoded}`);
    }
  };

  const scheduleNextHint = useMemo(
    () => describeNextScheduleAttemptLine(scheduleState, { loading: scheduleLoading }),
    [scheduleLoading, scheduleState],
  );
  const selectedScheduleMode = scheduleDraft.mode || "interval_from_now";

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate("/app")} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>返回首页</span>
      </button>
      <s-page heading="热点内容生成">
      <s-section heading="热点列表">
        <div className="dash-shell dash-section-inner">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--dash-muted)" }}>
              已勾选 {Object.keys(selectedHotspots).length} 个热点
            </span>
            <Space size="middle" wrap>
              <Button type={scheduleState.is_enabled ? "primary" : "default"} onClick={openScheduleModal} loading={scheduleLoading}>
                定时推荐：{scheduleState.is_enabled ? "已开启" : "已关闭"}
              </Button>
              {recommendationMode ? (
                <Button type="default" onClick={() => setRecommendationMode(false)}>
                  取消过滤
                </Button>
              ) : (
                <Button type="primary" onClick={openRecommendModal}>
                  根据匹配度过滤热点
                </Button>
              )}
              {recommendationMode ? (
                <Button type="default" onClick={cycleScoreSort}>
                  {scoreSortOrder == null
                    ? "按匹配分排序（高→低）"
                    : scoreSortOrder === "desc"
                    ? "按匹配分排序（低→高）"
                    : "恢复列表顺序"}
                </Button>
              ) : null}
              <Button type="primary" onClick={handleGenerate}>
                基于所选热点生成营销内容
              </Button>
            </Space>
          </div>
          <p
            style={{
              margin: "0 0 12px",
              color: "var(--dash-muted)",
              fontSize: "0.8125rem",
              lineHeight: 1.5,
            }}
          >
            {scheduleNextHint}
          </p>

          {loading && (
            <div className="dash-page-loading">
              <Spin size="large" />
            </div>
          )}

          {error && !loading && (
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <p className="dash-text-error">加载失败：{error}</p>
              <Button onClick={() => loadHotspotPage(1, false)}>重试</Button>
            </Space>
          )}

          {!loading && !error && hotspots.length === 0 && (
            <Empty
              description="暂无热点数据"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <p style={{ color: "var(--dash-muted)" }}>当前没有可用的热点内容，请稍后再试。</p>
            </Empty>
          )}

          {!loading && !error && hotspots.length > 0 && (
            <div className="hotspot-table">
              <div className="hotspot-table-header" role="row">
                <span>{recommendationMode ? "匹配分" : "选择"}</span>
                <span>标题</span>
                <span>摘要</span>
                <span>平台与时间</span>
                <span>互动数据</span>
              </div>
              <div className="hotspot-table-body">
                {displayHotspots.map((item, index) => {
                  const itemKey = hotspotRowKey(item);
                  return (
                  <HotspotItem
                    key={itemKey}
                    item={item}
                    index={index}
                    itemKey={itemKey}
                    checked={Boolean(selectedHotspots[itemKey])}
                    onToggleSelect={handleToggleSelect}
                    recommendationMode={recommendationMode}
                  />
                  );
                })}
              </div>
            </div>
          )}

          {loadingMore && (
            <div className="dash-page-loading" style={{ paddingTop: 12, paddingBottom: 8 }}>
              <Spin size="small" />
            </div>
          )}

          {reachedEnd && hotspots.length > 0 && !loadingMore && (
            <p className="dash-end-hint">
              到底了～
              {/* {totalPages} 页 */}
            </p>
          )}

          <div ref={sentinelRef} style={{ height: "1px" }} />

          <Modal
            title="品牌推荐热点"
            open={recommendModalOpen}
            onCancel={() => !recommendSubmitting && setRecommendModalOpen(false)}
            footer={null}
            destroyOnHidden
            width={440}
          >
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--dash-muted)", fontSize: "0.875rem" }}>
              设置最低契合度（0–100），将基于当前商户品牌对缓存中的热点做匹配并过滤后刷新列表。
            </p>
            <div style={{ marginBottom: 16 }}>
              <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>min_compatibility_score</span>
              <InputNumber
                min={0}
                max={100}
                step={1}
                value={recommendMinScore}
                onChange={(v) => setRecommendMinScore(v == null ? null : Number(v))}
                style={{ width: "100%" }}
              />
            </div>
            <Space style={{ width: "100%", justifyContent: "flex-end" }}>
              <Button onClick={() => setRecommendModalOpen(false)} disabled={recommendSubmitting}>
                取消
              </Button>
              <Button type="primary" onClick={handleConfirmStartRecommend} loading={recommendSubmitting}>
                开始过滤
              </Button>
            </Space>
          </Modal>

          <Modal
            title="定时推荐任务设置"
            open={scheduleModalOpen}
            onCancel={() => !scheduleSubmitting && setScheduleModalOpen(false)}
            footer={null}
            destroyOnHidden
            width={460}
          >
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ margin: 0, color: "var(--dash-muted)", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                支持三种模式：从当前时刻按间隔、每日固定时间、固定时间窗口+间隔。请按当前 mode 填写并确认保存；关闭并保存会停止任务并清空相关锚点。
              </p>
              <div>
                <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>是否开启定时推荐</span>
                <Switch
                  checked={Boolean(scheduleDraft.is_enabled)}
                  onChange={(checked) => setScheduleDraft((prev) => ({ ...prev, is_enabled: checked }))}
                />
              </div>
              <div>
                <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>模式（mode）</span>
                <Select
                  style={{ width: "100%" }}
                  value={scheduleDraft.mode}
                  options={SCHEDULE_MODE_OPTIONS}
                  onChange={(value) => setScheduleDraft((prev) => ({ ...prev, mode: value }))}
                />
              </div>
              {selectedScheduleMode === "interval_from_now" ? (
                <p style={{ margin: 0, color: "var(--dash-muted)", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                  当前为「从此刻开始间隔触发」：只按间隔小时数判断；固定时刻参数会保存但不参与该模式判断。
                </p>
              ) : null}
              {selectedScheduleMode === "daily_fixed" ? (
                <p style={{ margin: 0, color: "var(--dash-muted)", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                  当前为「每日固定时间」：每天在你设置的小时/分钟尝试触发；间隔小时不是核心判断条件。
                </p>
              ) : null}
              {selectedScheduleMode === "interval_from_fixed" ? (
                <p style={{ margin: 0, color: "var(--dash-muted)", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                  当前为「固定时间窗口 + 间隔」：命中固定时间窗口时触发，且需满足两次成功发送最短间隔。
                </p>
              ) : null}
              <div>
                <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>最低匹配分数（min_compatibility_score）</span>
                <InputNumber
                  min={0}
                  max={100}
                  step={1}
                  value={scheduleDraft.min_compatibility_score}
                  onChange={(v) =>
                    setScheduleDraft((prev) => ({
                      ...prev,
                      min_compatibility_score:
                        v == null || Number.isNaN(Number(v)) ? DEFAULT_MIN_COMPATIBILITY_SCORE : Number(v),
                    }))
                  }
                  style={{ width: "100%" }}
                />
              </div>
              {selectedScheduleMode !== "interval_from_now" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>固定发送小时（send_hour）</span>
                    <InputNumber
                      min={0}
                      max={23}
                      step={1}
                      value={scheduleDraft.send_hour}
                      onChange={(v) =>
                        setScheduleDraft((prev) => ({
                          ...prev,
                          send_hour:
                            v == null || Number.isNaN(Number(v))
                              ? DEFAULT_SCHEDULE_STATE.send_hour
                              : Number(v),
                        }))
                      }
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>固定发送分钟（send_minute）</span>
                    <InputNumber
                      min={0}
                      max={59}
                      step={1}
                      value={scheduleDraft.send_minute}
                      onChange={(v) =>
                        setScheduleDraft((prev) => ({
                          ...prev,
                          send_minute:
                            v == null || Number.isNaN(Number(v))
                              ? DEFAULT_SCHEDULE_STATE.send_minute
                              : Number(v),
                        }))
                      }
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              ) : null}
              {selectedScheduleMode !== "daily_fixed" ? (
                <div>
                  <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>定时最短间隔（小时）</span>
                  <InputNumber
                    min={1}
                    max={8760}
                    step={1}
                    value={scheduleDraft.interval_hours}
                    onChange={(v) =>
                      setScheduleDraft((prev) => ({
                        ...prev,
                        interval_hours: v == null || Number.isNaN(Number(v)) ? 24 : Number(v),
                      }))
                    }
                    style={{ width: "100%" }}
                  />
                </div>
              ) : null}
              {scheduleState.last_sent_at ? (
                <p style={{ margin: 0, color: "var(--dash-muted)", fontSize: "0.8125rem" }}>
                  上次成功发送（UTC）：{String(scheduleState.last_sent_at)}
                </p>
              ) : null}
              {scheduleState.last_triggered_at ? (
                <p style={{ margin: 0, color: "var(--dash-muted)", fontSize: "0.8125rem" }}>
                  上次触发尝试（UTC）：{String(scheduleState.last_triggered_at)}
                </p>
              ) : null}
            </div>
            <Space style={{ width: "100%", justifyContent: "flex-end", marginTop: 18 }}>
              <Button onClick={() => setScheduleModalOpen(false)} disabled={scheduleSubmitting}>
                取消
              </Button>
              <Button type="primary" onClick={handleSaveSchedule} loading={scheduleSubmitting}>
                确认
              </Button>
            </Space>
          </Modal>
        </div>
      </s-section>
    </s-page>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
