import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Space, Spin, Empty, message } from "antd";
import { authFetch } from "../utils/auth-api";

const PAGE_SIZE = 10;

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return tags.join(" · ");
}

function formatAudience(audience) {
  if (!Array.isArray(audience) || audience.length === 0) return "";
  return audience.join("、");
}

// eslint-disable-next-line react/prop-types
function HotspotItem({
  item = {},
  index,
  itemKey,
  checked,
  onToggleSelect,
}) {
  const tagsStr = formatTags(item.tags);
  const audienceStr = formatAudience(item.audience);
  const viewsLikes = [
    item.view_count != null ? `${item.view_count} 浏览` : null,
    item.likes != null ? `${item.likes} 赞` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const extraParts = [];
  if (item.risk_category && item.risk_category !== "NONE") {
    extraParts.push(`风险：${item.risk_category}`);
  }
  if (item.warning_message) {
    extraParts.push(item.warning_message);
  }
  if (item.sentiment_score != null && item.sentiment_score !== 0) {
    extraParts.push(`情感分：${item.sentiment_score}`);
  }
  if (audienceStr) {
    extraParts.push(`受众：${audienceStr}`);
  }
  const hasExtra = extraParts.length > 0 || item.jump_url;

  return (
    <div className="hotspot-table-body-group">
      <div
        className={`hotspot-table-row ${index % 2 === 1 ? "hotspot-table-row--alt" : ""}`}
        role="row"
      >
        <div
          style={{
            width: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleSelect(itemKey, item)}
            aria-label={`选择热点：${item.title || "未命名热点"}`}
          />
        </div>
        <div className="hotspot-table-row__col hotspot-table-row__col--title">
          <span className="hotspot-table-row__title">{item.title || "—"}</span>
          {tagsStr ? (
            <span className="hotspot-table-row__sub">{tagsStr}</span>
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
      {hasExtra ? (
        <div
          className={`hotspot-table-row-extra ${index % 2 === 1 ? "hotspot-table-row--alt" : ""}`}
        >
          {extraParts.length > 0 ? <span>{extraParts.join(" ｜ ")}</span> : null}
          {item.jump_url ? (
            <div style={{ marginTop: extraParts.length ? "0.35rem" : 0 }}>
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
      const res = await authFetch("/api/hotspot/hot-trends", {
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

  useEffect(() => {
    loadHotspotPage(1, false);
  }, [loadHotspotPage]);

  useEffect(() => {
    if (loading || loadingMore || error) return;

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
  }, [currentPage, error, loading, loadingMore, loadHotspotPage, totalPages]);

  const handleToggleSelect = (itemKey, hotspot) => {
    setSelectedHotspots((prev) => {
      if (prev[itemKey]) {
        const next = { ...prev };
        delete next[itemKey];
        return next;
      }
      return { ...prev, [itemKey]: hotspot };
    });
  };

  const handleGenerate = () => {
    const selectedList = Object.values(selectedHotspots);
    if (selectedList.length === 0) {
      message.warning("请先勾选至少一个热点");
      return;
    }
    const encoded = encodeURIComponent(JSON.stringify(selectedList));
    navigate(`/app/match?hotspots=${encoded}`);
  };

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
            <Button type="primary" onClick={handleGenerate}>
              基于所选热点生成营销内容
            </Button>
          </div>

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
                <span aria-hidden className="hotspot-table-header__spacer" />
                <span>选择</span>
                <span>标题</span>
                <span>摘要</span>
                <span>平台与时间</span>
                <span>互动数据</span>
              </div>
              <div className="hotspot-table-body">
                {hotspots.map((item, index) => {
                  // 列表可能出现无 id 项，因此使用 id + index 生成稳定 key
                  const itemKey = `${item.id ?? item.title ?? "hotspot"}-${index}`;
                  return (
                  <HotspotItem
                    key={itemKey}
                    item={item}
                    index={index}
                    itemKey={itemKey}
                    checked={Boolean(selectedHotspots[itemKey])}
                    onToggleSelect={handleToggleSelect}
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
        </div>
      </s-section>
    </s-page>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
