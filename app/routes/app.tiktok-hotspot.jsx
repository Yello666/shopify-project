import { useCallback, useEffect, useMemo, useState } from "react";
/* eslint-disable react/prop-types */
import { useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Dropdown, Empty, Input, InputNumber, message, Modal, Space, Spin, Tooltip } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { authFetch } from "../utils/auth-api";

const DEFAULT_TIKTOK_MAX_RESULTS = 20;
const DEFAULT_TIKTOK_COMMENTS_PER_POST = 3;
const DEFAULT_MIN_COMPATIBILITY_SCORE = 60;

function pickResponseData(json) {
  return json?.data && typeof json.data === "object" ? json.data : json;
}

function normalizeHashtags(value) {
  return String(value || "")
    .split(/[\s,，#]+/)
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean);
}

function uniqueHashtags(tags) {
  return [...new Set(tags)];
}

function buildTiktokRequestBody(nextHashtags, minCompatibilityScore) {
  const body = {
    hashtags: nextHashtags,
    max_results: DEFAULT_TIKTOK_MAX_RESULTS,
    comments_per_post: DEFAULT_TIKTOK_COMMENTS_PER_POST,
    sort: {
      sort_by: "diggs",
      sort_order: "desc",
      limit: DEFAULT_TIKTOK_MAX_RESULTS,
    },
  };
  if (minCompatibilityScore != null) {
    body.min_compatibility_score = minCompatibilityScore;
  }
  return body;
}

function pickTrendList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  if (Array.isArray(json?.items)) return json.items;
  return [];
}

function flattenRecommendedItem(raw) {
  const trend = raw?.trend && typeof raw.trend === "object" ? raw.trend : raw;
  const match = raw?.match && typeof raw.match === "object" ? raw.match : null;
  const rec = match?.recommendation;
  const recommendationLabel =
    typeof rec === "string"
      ? rec
      : rec != null && typeof rec === "object" && "value" in rec
      ? String(rec.value)
      : "";

  return {
    ...trend,
    match_score: match?.compatibility_score ?? trend.match_score,
    recommend_reason: match?.reason ?? "",
    recommend_level: recommendationLabel || "",
    marketing_suggestion: match?.suggestion ?? "",
    radar: match?.radar ?? trend?.radar ?? null,
  };
}

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return tags.join(" · ");
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN");
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("zh-CN", { hour12: false });
}

function normalizeProductOpportunities(item) {
  const raw = item?.product_opportunities ?? item?.product_opportunity;
  if (Array.isArray(raw)) return raw.filter((op) => op && typeof op === "object");
  if (raw && typeof raw === "object") return [raw];
  return [];
}

function productOpportunityRowKey(opportunity, idx) {
  return `${opportunity?.product_name || "opportunity"}-${idx}`;
}

function HotspotProductOpportunities({ opportunities }) {
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());

  const toggle = useCallback((key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (!opportunities.length) return null;

  return (
    <div className="hotspot-product-opportunities">
      <div className="hotspot-product-opportunities__title">商品机会</div>
      <div className="hotspot-product-opportunities__list">
        {opportunities.map((opportunity, idx) => {
          const sellingPoints = Array.isArray(opportunity?.selling_points)
            ? opportunity.selling_points.filter(Boolean).map(String)
            : [];
          const rowKey = productOpportunityRowKey(opportunity, idx);
          const isOpen = expandedKeys.has(rowKey);
          const label = opportunity?.product_name || `商品机会 ${idx + 1}`;

          return (
            <div className="hotspot-product-opportunity" key={rowKey}>
              <div className="hotspot-product-opportunity__header">
                <span className="hotspot-product-opportunity__name">{label}</span>
                <button
                  type="button"
                  className={`hotspot-product-opportunity__toggle hotspot-product-opportunity__toggle--icon${
                    isOpen ? " is-open" : ""
                  }`}
                  onClick={() => toggle(rowKey)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `收起「${label}」详情` : `展开「${label}」详情`}
                >
                  <DownOutlined aria-hidden />
                </button>
              </div>
              {isOpen ? (
                <div className="hotspot-product-opportunity__body">
                  {opportunity?.reason ? (
                    <p>
                      <strong>适合原因：</strong>
                      {opportunity.reason}
                    </p>
                  ) : null}
                  {opportunity?.target_audience ? (
                    <p>
                      <strong>目标人群：</strong>
                      {opportunity.target_audience}
                    </p>
                  ) : null}
                  {opportunity?.production_difficulty ? (
                    <p>
                      <strong>制作难度：</strong>
                      {opportunity.production_difficulty}
                    </p>
                  ) : null}
                  {sellingPoints.length ? (
                    <p>
                      <strong>卖点：</strong>
                      {sellingPoints.join("、")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function parseMatchScoreNumber(item) {
  const raw = item?.match_score ?? item?.matchScore;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && raw.trim() !== "—") {
    const n = Number.parseFloat(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const RECOMMEND_SORT_OPTIONS = [
  { key: "match_score", label: "匹配分" },
  { key: "view_count", label: "播放量" },
  { key: "likes", label: "点赞数" },
  { key: "comment_count", label: "评论数" },
  { key: "share_count", label: "分享数" },
  { key: "collect_count", label: "收藏数" },
  { key: "duration_seconds", label: "视频时长" },
  { key: "publish_time", label: "发布时间" },
];

const RECOMMEND_SORT_RESET_KEY = "__reset__";

function parseNumericSortValue(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getRecommendSortValue(item, field) {
  switch (field) {
    case "match_score":
      return parseMatchScoreNumber(item);
    case "view_count":
      return parseNumericSortValue(item?.view_count);
    case "likes":
      return parseNumericSortValue(item?.likes);
    case "comment_count":
      return parseNumericSortValue(item?.comment_count);
    case "share_count":
      return parseNumericSortValue(item?.share_count);
    case "collect_count":
      return parseNumericSortValue(item?.collect_count);
    case "duration_seconds":
      return parseNumericSortValue(item?.duration_seconds);
    case "publish_time": {
      if (!item?.publish_time) return null;
      const t = new Date(item.publish_time).getTime();
      return Number.isFinite(t) ? t : null;
    }
    default:
      return null;
  }
}

function compareRecommendSortItems(a, b, field, order) {
  const va = getRecommendSortValue(a, field);
  const vb = getRecommendSortValue(b, field);
  const aMissing = va == null;
  const bMissing = vb == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (order === "desc") return vb - va;
  return va - vb;
}

function sortRecommendItems(items, field, order) {
  const copy = [...items];
  copy.sort((a, b) => compareRecommendSortItems(a, b, field, order));
  return copy;
}

function recommendSortLabel(field) {
  return RECOMMEND_SORT_OPTIONS.find((opt) => opt.key === field)?.label ?? "";
}

function matchScoreToneClass(score) {
  if (score == null || Number.isNaN(score)) return "hotspot-match-score--none";
  if (score < 40) return "hotspot-match-score--low";
  if (score < 60) return "hotspot-match-score--mid";
  if (score < 80) return "hotspot-match-score--good";
  return "hotspot-match-score--high";
}

const MATCH_RADAR_KEYS = [
  { key: "business_relevance", label: "业务相关度" },
  { key: "audience_overlap", label: "受众重合" },
  { key: "brand_voice_fit", label: "品牌调性契合" },
  { key: "marketing_risk", label: "营销风险" },
];

function formatRadarMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return String(n);
    return value.trim();
  }
  return "—";
}

function renderMatchRadarTooltipTitle(radar) {
  if (!radar || typeof radar !== "object") {
    return <span className="hotspot-radar-tooltip__empty">暂无雷达细分数据</span>;
  }
  return (
    <div className="hotspot-radar-tooltip">
      {MATCH_RADAR_KEYS.map(({ key, label }) => (
        <div key={key} className="hotspot-radar-tooltip__row">
          <span className="hotspot-radar-tooltip__label">
            {label}
            <span className="hotspot-radar-tooltip__label-en">{key}</span>
          </span>
          <span className="hotspot-radar-tooltip__value">{formatRadarMetric(radar[key])}</span>
        </div>
      ))}
    </div>
  );
}

function tiktokRowKey(item) {
  if (item?.id != null && String(item.id).trim()) return String(item.id);
  return `${item.title ?? ""}|${item.publish_time ?? ""}|${item.jump_url ?? ""}`;
}

function TiktokHotspotItem({
  item,
  index,
  itemKey,
  checked,
  onToggleSelect,
  recommendationMode,
}) {
  const tagsStr = formatTags(item.tags);
  const scoreNumeric = parseMatchScoreNumber(item);
  const matchScore = scoreNumeric != null ? `${Math.round(scoreNumeric)}` : "—";
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
  const productOpportunities = normalizeProductOpportunities(item);
  const radar = item.radar && typeof item.radar === "object" ? item.radar : null;

  return (
    <div className="hotspot-table-body-group">
      <div
        className={`hotspot-table-row ${index % 2 === 1 ? "hotspot-table-row--alt" : ""}`}
        role="row"
      >
        <div
          className="hotspot-table-row__select-cell"
          style={{
            width: recommendationMode ? "100%" : 0,
            display: recommendationMode ? "flex" : "none",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: recommendationMode ? "0.45rem" : 0,
          }}
          aria-hidden={!recommendationMode}
        >
          {recommendationMode ? (
            <Tooltip
              title={renderMatchRadarTooltipTitle(radar)}
              placement="left"
              mouseEnterDelay={0.08}
            >
              <span
                className="hotspot-match-score-wrap"
                aria-label={`匹配分数 ${matchScore}，悬停查看雷达细分`}
              >
                <span className={`hotspot-match-score ${scoreToneClass}`}>{matchScore}</span>
                <span className="hotspot-match-score__hint" aria-hidden="true">
                  ?
                </span>
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--title">
          <span className="hotspot-table-row__title">{item.title || "TikTok 热点视频"}</span>
          {tagsStr ? <span className="hotspot-table-row__sub">标签：{tagsStr}</span> : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--summary">
          <span className="hotspot-table-row__text">{item.summary || "—"}</span>
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--meta">
          <span className="hotspot-table-row__text">{item.platform || "TikTok"}</span>
          {item.publish_time ? (
            <span className="hotspot-table-row__sub">发布于 {formatDateTime(item.publish_time)}</span>
          ) : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--meta">
          <span className="hotspot-table-row__text">
            {formatNumber(item.view_count)} 播放 · {formatNumber(item.likes)} 赞
          </span>
          <span className="hotspot-table-row__sub">
            {formatNumber(item.comment_count)} 评论 · {formatNumber(item.share_count)} 分享 ·{" "}
            {formatNumber(item.collect_count)} 收藏
          </span>
          <span className="hotspot-table-row__sub">
            作者粉丝 {formatNumber(item.author_followers)} · {formatNumber(item.duration_seconds)} 秒
          </span>
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--action">
          {item.jump_url ? (
            <a href={item.jump_url} target="_blank" rel="noopener noreferrer">
              查看原文
            </a>
          ) : (
            "—"
          )}
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
              name="tiktok-hotspot-recommend-radio"
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
              <HotspotProductOpportunities opportunities={productOpportunities} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch {
    // 未登录或网络异常时允许页面降级渲染，接口请求会再处理鉴权。
  }
  return null;
};

export default function TiktokHotspot() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hashtags = useMemo(
    () => uniqueHashtags(normalizeHashtags(searchParams.get("hashtags"))),
    [searchParams],
  );
  const [draft, setDraft] = useState(hashtags.join(", "));
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isRecommendList, setIsRecommendList] = useState(false);
  const [selectedHotspots, setSelectedHotspots] = useState({});
  const [recommendModalOpen, setRecommendModalOpen] = useState(false);
  const [recommendMinScore, setRecommendMinScore] = useState(DEFAULT_MIN_COMPATIBILITY_SCORE);
  const [recommendSubmitting, setRecommendSubmitting] = useState(false);
  const [listSort, setListSort] = useState({ field: null, order: "desc" });

  useEffect(() => {
    setDraft(hashtags.join(", "));
  }, [hashtags]);

  const loadTiktokHotspots = useCallback(async (nextHashtags) => {
    if (!nextHashtags.length) {
      setItems([]);
      setError("");
      setIsRecommendList(false);
      setSelectedHotspots({});
      return;
    }

    setLoading(true);
    setError("");
    setIsRecommendList(false);
    setSelectedHotspots({});
    setListSort({ field: null, order: "desc" });
    try {
      const res = await authFetch("/api/v1/hotspot/tiktok/hashtag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTiktokRequestBody(nextHashtags)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail ?? json?.message;
        throw new Error(typeof detail === "string" ? detail : `请求失败: ${res.status}`);
      }
      setItems(pickTrendList(json));
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("登录已过期，请返回首页重新登录");
        setError("登录已过期，请返回首页重新登录");
        return;
      }
      setError(err?.message || "TikTok 热点加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTiktokHotspots(hashtags);
  }, [hashtags, loadTiktokHotspots]);

  const handleSearch = () => {
    const nextHashtags = uniqueHashtags(normalizeHashtags(draft));
    if (!nextHashtags.length) {
      message.warning("请至少输入一个 hashtag");
      return;
    }
    setSearchParams({ hashtags: nextHashtags.join(",") });
  };

  const handleStartRecommend = async () => {
    if (!hashtags.length) {
      message.warning("请先输入 hashtags 并获取热点");
      return;
    }
    const minScore = Number(recommendMinScore);
    if (!Number.isFinite(minScore)) {
      message.warning("请先填写最低契合度分数");
      return;
    }
    setRecommendSubmitting(true);
    try {
      const res = await authFetch("/api/v1/hotspot/tiktok/hashtag/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTiktokRequestBody(hashtags, minScore)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail ?? json?.message;
        throw new Error(
          typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `请求失败: ${res.status}`,
        );
      }
      const envelope = pickResponseData(json);
      const rawItems = Array.isArray(envelope?.items) ? envelope.items : [];
      const mapped = rawItems.map(flattenRecommendedItem);
      setItems(mapped);
      setSelectedHotspots({});
      setIsRecommendList(true);
      setListSort({ field: null, order: "desc" });
      setRecommendModalOpen(false);
      const appliedMin = Number(envelope?.min_compatibility_score);
      if (Number.isFinite(appliedMin)) {
        setRecommendMinScore(appliedMin);
      }
      message.success(
        mapped.length
          ? `已加载 ${mapped.length} 条推荐热点`
          : "暂无达到阈值的推荐热点，可调低契合度后重试",
      );
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("登录已过期，请返回首页重新登录");
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

  const handleExitRecommend = () => {
    loadTiktokHotspots(hashtags);
  };

  const handleToggleSelect = (itemKey, hotspot) => {
    setSelectedHotspots((prev) => (prev[itemKey] ? {} : { [itemKey]: hotspot }));
  };

  const handleGenerate = () => {
    const selectedList = Object.values(selectedHotspots);
    if (selectedList.length === 0) {
      message.warning("请先选择一个热点");
      return;
    }
    const hotspot = selectedList[0];
    const encoded = encodeURIComponent(JSON.stringify(hotspot));
    navigate(`/app/generate?hotspot=${encoded}`);
  };

  const handleRecommendSortMenuClick = useCallback(({ key }) => {
    if (key === RECOMMEND_SORT_RESET_KEY) {
      setListSort({ field: null, order: "desc" });
      return;
    }
    setListSort((prev) => {
      if (prev.field === key) {
        return { field: key, order: prev.order === "desc" ? "asc" : "desc" };
      }
      return { field: key, order: "desc" };
    });
  }, []);

  const recommendSortMenu = useMemo(
    () => ({
      items: [
        ...RECOMMEND_SORT_OPTIONS.map((opt) => ({ key: opt.key, label: opt.label })),
        { type: "divider" },
        { key: RECOMMEND_SORT_RESET_KEY, label: "恢复默认顺序" },
      ],
      selectedKeys: listSort.field ? [listSort.field] : [],
      onClick: handleRecommendSortMenuClick,
    }),
    [listSort.field, handleRecommendSortMenuClick],
  );

  const recommendSortButtonLabel = useMemo(() => {
    if (!listSort.field) return "排序";
    const label = recommendSortLabel(listSort.field);
    const arrow = listSort.order === "desc" ? "↓" : "↑";
    return `排序：${label} ${arrow}`;
  }, [listSort.field, listSort.order]);

  const displayItems = useMemo(() => {
    if (!listSort.field) return items;
    return sortRecommendItems(items, listSort.field, listSort.order);
  }, [items, listSort.field, listSort.order]);

  const emptyDescription = isRecommendList
    ? "暂无达到阈值的推荐热点"
    : hashtags.length > 0
    ? "暂无 TikTok 热点数据"
    : "请输入 hashtags";

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate("/app/hotspot")} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>返回热点列表</span>
      </button>
      <s-page heading="TikTok 热点">
        <s-section heading="按 Hashtag 获取热点">
          <div className="dash-shell dash-section-inner">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <span style={{ color: "var(--dash-muted)" }}>
                {isRecommendList
                  ? `推荐结果：${items.length} 条`
                  : hashtags.length
                  ? `当前 hashtags：${hashtags.map((tag) => `#${tag}`).join("、")}`
                  : "请输入 hashtags 获取 TikTok 热点"}
                {isRecommendList ? (
                  <span style={{ marginLeft: 12 }}>
                    已选择 {Object.keys(selectedHotspots).length} 个热点
                  </span>
                ) : null}
              </span>
              <Space size="middle" wrap>
                <Space.Compact style={{ width: 420, maxWidth: "100%" }}>
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPressEnter={handleSearch}
                    placeholder="例如：skincare, beauty"
                    disabled={loading || recommendSubmitting}
                  />
                  <Button type="primary" onClick={handleSearch} loading={loading} disabled={recommendSubmitting}>
                    获取
                  </Button>
                </Space.Compact>
                {hashtags.length > 0 && !isRecommendList ? (
                  <Button type="primary" onClick={() => setRecommendModalOpen(true)} disabled={loading}>
                    根据匹配度推荐
                  </Button>
                ) : null}
                {isRecommendList ? (
                  <Button onClick={handleExitRecommend} disabled={loading}>
                    取消推荐
                  </Button>
                ) : null}
                {isRecommendList ? (
                  <Dropdown menu={recommendSortMenu} trigger={["click"]}>
                    <Button>
                      {recommendSortButtonLabel}
                      <DownOutlined style={{ marginLeft: 6, fontSize: 10 }} aria-hidden />
                    </Button>
                  </Dropdown>
                ) : null}
                {isRecommendList ? (
                  <Button type="primary" onClick={handleGenerate}>
                    基于所选热点生成营销内容
                  </Button>
                ) : null}
              </Space>
            </div>

            {loading ? (
              <div className="dash-page-loading">
                <Spin size="large" />
              </div>
            ) : null}

            {!loading && error ? (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <p className="dash-text-error">加载失败：{error}</p>
                <Button onClick={() => (isRecommendList ? handleExitRecommend() : loadTiktokHotspots(hashtags))}>
                  重试
                </Button>
              </Space>
            ) : null}

            {!loading && !error && items.length === 0 ? (
              <Empty description={emptyDescription} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <p style={{ color: "var(--dash-muted)" }}>
                  {isRecommendList
                    ? "可调低契合度后重试，或取消推荐查看全部热点。"
                    : hashtags.length
                    ? "可以换一组 hashtag 后重试。"
                    : "例如 skincare、beauty、fyp。"}
                </p>
              </Empty>
            ) : null}

            {!loading && !error && items.length > 0 ? (
              <div
                className={`hotspot-table tiktok-hotspot-table${
                  isRecommendList ? " tiktok-hotspot-table--recommend" : ""
                }`}
              >
                <div className="hotspot-table-header" role="row">
                  {isRecommendList ? <span>匹配分</span> : null}
                  <span>标题</span>
                  <span>摘要</span>
                  <span>平台与时间</span>
                  <span>互动数据</span>
                  <span>原文</span>
                </div>
                <div className="hotspot-table-body">
                  {displayItems.map((item, index) => {
                    const itemKey = tiktokRowKey(item);
                    return (
                      <TiktokHotspotItem
                        key={itemKey}
                        item={item}
                        index={index}
                        itemKey={itemKey}
                        checked={Boolean(selectedHotspots[itemKey])}
                        onToggleSelect={handleToggleSelect}
                        recommendationMode={isRecommendList}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}

            <Modal
              title="品牌推荐 TikTok 热点"
              open={recommendModalOpen}
              onCancel={() => !recommendSubmitting && setRecommendModalOpen(false)}
              footer={null}
              destroyOnHidden
              width={440}
            >
              <p style={{ marginTop: 0, marginBottom: 12, color: "var(--dash-muted)", fontSize: "0.875rem" }}>
                设置最低契合度（0–100），将基于当前商户品牌对本次 hashtags 抓取的热点做匹配并过滤后刷新列表。
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
                  开始推荐
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
