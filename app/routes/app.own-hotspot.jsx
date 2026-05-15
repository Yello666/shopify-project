import { useState, useEffect, useCallback, useMemo } from "react";
/* eslint-disable react/prop-types */
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Space, Spin, Empty, message, Modal, InputNumber, Input, Tooltip } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { authFetch } from "../utils/auth-api";

const OWN_HOTSPOT_API_BASE = "/api/v1/own-hotspot";
const DEFAULT_MIN_COMPATIBILITY_SCORE = 60;

function pickResponseData(json) {
  return json?.data && typeof json.data === "object" ? json.data : json;
}

// 把 List<string> 渲染成「美食 · 跨界」单行
function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return tags.join(" · ");
}

function formatAudience(audience) {
  if (!Array.isArray(audience) || audience.length === 0) return "";
  return audience.join("、");
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

// eslint-disable-next-line react/prop-types
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

// 把后端 ISO 时间转成 yyyy-MM-dd HH:mm（用户本地时区）；解析失败返回原字符串
function formatCreatedAt(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 用户在 Modal 里把 tags / audience 用中英文逗号分隔，统一切成数组
function parseListInput(str) {
  const s = String(str || "").trim();
  if (!s) return [];
  return s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
}

// 推荐接口返回 { hotspot, match }，把它压平成与列表项同形状（多出 match_* 字段），便于复用渲染逻辑
function flattenRecommendedItem(raw) {
  const hotspot = raw?.hotspot && typeof raw.hotspot === "object" ? raw.hotspot : raw;
  const match = raw?.match && typeof raw.match === "object" ? raw.match : null;
  const rec = match?.recommendation;
  const recommendationLabel =
    typeof rec === "string"
      ? rec
      : rec != null && typeof rec === "object" && "value" in rec
      ? String(rec.value)
      : "";
  return {
    ...hotspot,
    match_score: match?.compatibility_score ?? null,
    recommend_reason: match?.reason ?? "",
    recommend_level: recommendationLabel || "",
    marketing_suggestion: match?.suggestion ?? "",
    radar: match?.radar ?? hotspot?.radar ?? null,
  };
}

function parseMatchScoreNumber(item) {
  const raw = item?.match_score;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
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

// eslint-disable-next-line react/prop-types
function OwnHotspotItem({
  item,
  index,
  recommendationMode,
  checked,
  onToggleSelect,
  onEdit,
  onDelete,
}) {
  const tagsStr = formatTags(item.tags);
  const audienceStr = formatAudience(item.audience);
  const createdAtStr = formatCreatedAt(item.created_at);

  const scoreNumeric = parseMatchScoreNumber(item);
  const matchScore =
    scoreNumeric != null ? `${Math.round(scoreNumeric)}` : "—";
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
            width: recommendationMode ? "100%" : "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
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
          ) : (
            <span style={{ color: "var(--dash-muted)", fontSize: "0.8125rem" }}>
              {item.id}
            </span>
          )}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--title">
          <span className="hotspot-table-row__title">{item.title || "—"}</span>
          {tagsStr ? (
            <span className="hotspot-table-row__sub">标签：{tagsStr}</span>
          ) : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--summary">
          <span className="hotspot-table-row__text">{item.summary || "—"}</span>
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--meta">
          <span className="hotspot-table-row__text">
            {audienceStr ? `受众：${audienceStr}` : "—"}
          </span>
          {createdAtStr ? (
            <span className="hotspot-table-row__sub">创建于 {createdAtStr}</span>
          ) : null}
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--action">
          <Space size="small" wrap>
            <Button size="small" onClick={() => onEdit(item)}>
              编辑
            </Button>
            <Button size="small" danger onClick={() => onDelete(item)}>
              删除
            </Button>
          </Space>
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
              name="own-hotspot-recommend-radio"
              checked={checked}
              onChange={() => onToggleSelect(item)}
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
    // 未登录或网络异常时允许页面降级渲染
  }
  return null;
};

export default function OwnHotspot() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 推荐模式相关
  const [isRecommendList, setIsRecommendList] = useState(false);
  const [recommendModalOpen, setRecommendModalOpen] = useState(false);
  const [recommendMinScore, setRecommendMinScore] = useState(DEFAULT_MIN_COMPATIBILITY_SCORE);
  const [recommendSubmitting, setRecommendSubmitting] = useState(false);
  /** null=列表原始顺序；desc/asc=按匹配分纯前端排序 */
  const [scoreSortOrder, setScoreSortOrder] = useState(null);

  // 勾选状态：常规模式多选、推荐模式单选；key 用 item.id（每条都有）
  const [selectedItems, setSelectedItems] = useState({});

  // 编辑器（创建 / 修改共用）
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create"); // create | update
  const [editingId, setEditingId] = useState(null);
  const [editorForm, setEditorForm] = useState({
    title: "",
    summary: "",
    tagsStr: "",
    audienceStr: "",
  });
  const [editorSubmitting, setEditorSubmitting] = useState(false);

  // ── 列表加载 ─────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(OWN_HOTSPOT_API_BASE);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail ?? json?.message;
        throw new Error(typeof detail === "string" ? detail : `请求失败: ${res.status}`);
      }
      const data = pickResponseData(json);
      const list = Array.isArray(data) ? data : [];
      setItems(list);
      setIsRecommendList(false);
      setScoreSortOrder(null);
      setSelectedItems({});
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("登录已过期，请重新登录");
        setError("登录已过期，请返回首页重新登录");
        return;
      }
      setError(err?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ── 上传 / 修改热点 ──────────────────────────────────────────────────
  const openCreate = () => {
    setEditorMode("create");
    setEditingId(null);
    setEditorForm({ title: "", summary: "", tagsStr: "", audienceStr: "" });
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setEditorMode("update");
    setEditingId(item.id);
    setEditorForm({
      title: item.title || "",
      summary: item.summary || "",
      tagsStr: Array.isArray(item.tags) ? item.tags.join(",") : "",
      audienceStr: Array.isArray(item.audience) ? item.audience.join(",") : "",
    });
    setEditorOpen(true);
  };

  const handleSaveEditor = async () => {
    const title = editorForm.title.trim();
    const summary = editorForm.summary.trim();
    if (!title) {
      message.warning("请填写热点标题");
      return;
    }
    if (!summary) {
      message.warning("请填写热点摘要");
      return;
    }

    setEditorSubmitting(true);
    try {
      const payload = {
        title,
        summary,
        tags: parseListInput(editorForm.tagsStr),
        audience: parseListInput(editorForm.audienceStr),
      };
      const isUpdate = editorMode === "update" && editingId != null;
      const url = isUpdate
        ? `${OWN_HOTSPOT_API_BASE}/${editingId}`
        : OWN_HOTSPOT_API_BASE;
      const res = await authFetch(url, {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail ?? json?.message;
        throw new Error(typeof detail === "string" ? detail : `请求失败: ${res.status}`);
      }

      message.success(isUpdate ? "已保存" : "热点已上传");
      setEditorOpen(false);
      // 编辑/新建后刷新整页（与推荐结果分离，回到列表视图）
      await loadList();
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        message.warning("登录已过期，请返回首页重新登录");
        return;
      }
      message.error(err?.message || (editorMode === "update" ? "保存失败" : "上传失败"));
    } finally {
      setEditorSubmitting(false);
    }
  };

  // ── 删除 ─────────────────────────────────────────────────────────────
  const handleDelete = (item) => {
    Modal.confirm({
      title: "确认删除该热点？",
      content: `「${item.title || "未命名"}」删除后无法恢复。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await authFetch(`${OWN_HOTSPOT_API_BASE}/${item.id}`, {
            method: "DELETE",
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            const detail = json?.detail ?? json?.message;
            throw new Error(typeof detail === "string" ? detail : `请求失败: ${res.status}`);
          }
          message.success("已删除");
          // 从当前列表移除（无论是否处于推荐结果视图都同步）
          setItems((prev) => prev.filter((x) => x.id !== item.id));
          setSelectedItems((prev) => {
            const key = String(item.id);
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } catch (err) {
          if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
            message.warning("登录已过期，请返回首页重新登录");
            return;
          }
          message.error(err?.message || "删除失败");
        }
      },
    });
  };

  // ── 推荐 ─────────────────────────────────────────────────────────────
  const openRecommendModal = () => {
    setRecommendModalOpen(true);
  };

  const handleStartRecommend = async () => {
    const minScore = Number(recommendMinScore);
    if (!Number.isFinite(minScore)) {
      message.warning("请先填写最低契合度分数");
      return;
    }
    setRecommendSubmitting(true);
    try {
      const res = await authFetch(`${OWN_HOTSPOT_API_BASE}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min_compatibility_score: minScore }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail ?? json?.message;
        throw new Error(typeof detail === "string" ? detail : `请求失败: ${res.status}`);
      }
      const envelope = pickResponseData(json);
      const rawItems = Array.isArray(envelope?.items) ? envelope.items : [];
      const mapped = rawItems.map(flattenRecommendedItem);
      setItems(mapped);
      setIsRecommendList(true);
      setScoreSortOrder(null);
      setSelectedItems({});
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

  // 退出推荐视图：重新拉取常规列表
  const handleExitRecommend = () => {
    loadList();
  };

  // 勾选/取消勾选：常规多选；推荐单选（点已选项=取消，点新项=替换）
  const handleToggleSelect = (item) => {
    const key = String(item.id);
    if (isRecommendList) {
      setSelectedItems((prev) => (prev[key] ? {} : { [key]: item }));
    } else {
      setSelectedItems((prev) => {
        if (prev[key]) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: item };
      });
    }
  };

  // 跳转到生成视频流程：与原 hotspot 页一致
  // - 推荐模式：取所选 1 条 → /app/generate?hotspot=…
  // - 常规模式：取所选多条 → /app/match?hotspots=…（match 页内部跑匹配后再跳 generate）
  const handleGenerate = () => {
    const selectedList = Object.values(selectedItems);
    if (selectedList.length === 0) {
      message.warning(isRecommendList ? "请先选择一个热点" : "请先勾选至少一个热点");
      return;
    }
    if (isRecommendList) {
      const hotspot = selectedList[0];
      const encoded = encodeURIComponent(JSON.stringify(hotspot));
      navigate(`/app/generate?hotspot=${encoded}`);
    } else {
      const encoded = encodeURIComponent(JSON.stringify(selectedList));
      navigate(`/app/match?hotspots=${encoded}`);
    }
  };

  const cycleScoreSort = () => {
    setScoreSortOrder((prev) => {
      if (prev == null) return "desc";
      if (prev === "desc") return "asc";
      return null;
    });
  };

  // 推荐模式下按匹配分前端排序；常规模式直接用原顺序
  const displayItems = useMemo(() => {
    if (!scoreSortOrder) return items;
    const copy = [...items];
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
  }, [items, scoreSortOrder]);

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate("/app/hotspot")} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>返回热点页</span>
      </button>
      <s-page heading="我的热点">
        <s-section heading="自上传热点列表">
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
                {isRecommendList
                  ? `推荐结果：${items.length} 条`
                  : `已上传 ${items.length} 条热点`}
                {isRecommendList ? (
                  <span style={{ marginLeft: 12 }}>
                    已勾选 {Object.keys(selectedItems).length} 个热点
                  </span>
                ) : null}
              </span>
              <Space size="middle" wrap>
                {!isRecommendList ? (
                  <Button type="primary" onClick={openCreate}>
                    上传热点
                  </Button>
                ) : null}
                {isRecommendList ? (
                  <Button onClick={handleExitRecommend}>取消推荐</Button>
                ) : (
                  <Button type="primary" onClick={openRecommendModal}>
                    根据匹配度推荐
                  </Button>
                )}
                {isRecommendList ? (
                  <Button onClick={cycleScoreSort}>
                    {scoreSortOrder == null
                      ? "按匹配分排序（高→低）"
                      : scoreSortOrder === "desc"
                      ? "按匹配分排序（低→高）"
                      : "恢复列表顺序"}
                  </Button>
                ) : null}
                {isRecommendList ? (
                  <Button type="primary" onClick={handleGenerate}>
                    基于所选热点生成营销内容
                  </Button>
                ) : null}
              </Space>
            </div>

            {loading && (
              <div className="dash-page-loading">
                <Spin size="large" />
              </div>
            )}

            {error && !loading && (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <p className="dash-text-error">加载失败：{error}</p>
                <Button onClick={loadList}>重试</Button>
              </Space>
            )}

            {!loading && !error && items.length === 0 && (
              <Empty description={isRecommendList ? "暂无达到阈值的推荐结果" : "尚未上传任何热点"} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <p style={{ color: "var(--dash-muted)" }}>
                  {isRecommendList
                    ? "可调低契合度后重试，或先去上传更多热点。"
                    : "点击右上方「上传热点」开始添加你自己的营销热点。"}
                </p>
              </Empty>
            )}

            {!loading && !error && items.length > 0 && (
              <div className="hotspot-table">
                <div className="hotspot-table-header" role="row">
                  <span>{isRecommendList ? "匹配分" : "ID"}</span>
                  <span>标题</span>
                  <span>摘要</span>
                  <span>受众与时间</span>
                  <span>操作</span>
                </div>
                <div className="hotspot-table-body">
                  {displayItems.map((item, index) => (
                    <OwnHotspotItem
                      key={item.id ?? `${item.title}-${index}`}
                      item={item}
                      index={index}
                      recommendationMode={isRecommendList}
                      checked={Boolean(selectedItems[String(item.id)])}
                      onToggleSelect={handleToggleSelect}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}

            <Modal
              title={editorMode === "update" ? "修改热点" : "上传热点"}
              open={editorOpen}
              onCancel={() => !editorSubmitting && setEditorOpen(false)}
              footer={null}
              destroyOnHidden
              width={520}
            >
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <span style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                    标题 <span style={{ color: "#c4351a" }}>*</span>
                  </span>
                  <Input
                    value={editorForm.title}
                    onChange={(e) => setEditorForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="请输入热点标题"
                    maxLength={255}
                    showCount
                  />
                </div>
                <div>
                  <span style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                    摘要 <span style={{ color: "#c4351a" }}>*</span>
                  </span>
                  <Input.TextArea
                    value={editorForm.summary}
                    onChange={(e) => setEditorForm((f) => ({ ...f, summary: e.target.value }))}
                    placeholder="50–200 字最佳：简要描述这个热点"
                    rows={4}
                  />
                </div>
                <div>
                  <span style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                    标签（选填，逗号分隔）
                  </span>
                  <Input
                    value={editorForm.tagsStr}
                    onChange={(e) => setEditorForm((f) => ({ ...f, tagsStr: e.target.value }))}
                    placeholder="如：美食,跨界,双十一"
                  />
                </div>
                <div>
                  <span style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                    受众（选填，逗号分隔）
                  </span>
                  <Input
                    value={editorForm.audienceStr}
                    onChange={(e) => setEditorForm((f) => ({ ...f, audienceStr: e.target.value }))}
                    placeholder="如：18-35岁职场女性,硬核科技粉"
                  />
                </div>
              </div>
              <Space style={{ width: "100%", justifyContent: "flex-end", marginTop: 18 }}>
                <Button onClick={() => setEditorOpen(false)} disabled={editorSubmitting}>
                  取消
                </Button>
                <Button type="primary" onClick={handleSaveEditor} loading={editorSubmitting}>
                  {editorMode === "update" ? "保存" : "上传"}
                </Button>
              </Space>
            </Modal>

            <Modal
              title="根据品牌推荐我的热点"
              open={recommendModalOpen}
              onCancel={() => !recommendSubmitting && setRecommendModalOpen(false)}
              footer={null}
              destroyOnHidden
              width={440}
            >
              <p style={{ marginTop: 0, marginBottom: 12, color: "var(--dash-muted)", fontSize: "0.875rem" }}>
                设置最低契合度（0–100），将基于当前商户品牌对你已上传的热点做匹配并过滤后刷新列表。
              </p>
              <div style={{ marginBottom: 16 }}>
                <span style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                  min_compatibility_score
                </span>
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
