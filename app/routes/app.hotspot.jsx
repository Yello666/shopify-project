import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Space, Spin, Empty, message } from "antd";
import { authFetch } from "../utils/auth-api";

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return tags.join(" · ");
}

function formatAudience(audience) {
  if (!Array.isArray(audience) || audience.length === 0) return "";
  return audience.join("、");
}

// eslint-disable-next-line react/prop-types
function HotspotItem({ item = {}, index, onGenerate }) {
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
        <div className="hotspot-table-row__avatar" aria-hidden />
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
          <Button onClick={() => onGenerate(item)} className="hotspot-table-row__btn--full">
            基于此热点生成营销内容
          </Button>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const sentinelRef = useRef(null);

  useEffect(() => {
    authFetch("/api/hotspot/hot-trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platforms: ["youtube"], max_results: 5 }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`请求失败: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.data ?? [];
        setHotspots(list);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
          message.warning("请先登录");
          navigate("/app");
          return;
        }
        setError(err.message);
        setLoading(false);
      });
  }, [navigate]);

  const hasItems = hotspots.length > 0;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setReachedEnd(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasItems]);

  const handleGenerate = (hotspot) => {
    const encoded = encodeURIComponent(JSON.stringify(hotspot));
    navigate(`/app/match?hotspot=${encoded}`);
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
          {loading && (
            <div className="dash-page-loading">
              <Spin size="large" />
            </div>
          )}

          {error && !loading && (
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <p className="dash-text-error">加载失败：{error}</p>
              <Button onClick={() => window.location.reload()}>重试</Button>
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
                <span>标题</span>
                <span>摘要</span>
                <span>平台与时间</span>
                <span>互动与操作</span>
              </div>
              <div className="hotspot-table-body">
                {hotspots.map((item, index) => (
                  <HotspotItem
                    key={item.id ?? index}
                    item={item}
                    index={index}
                    onGenerate={handleGenerate}
                  />
                ))}
              </div>
            </div>
          )}

          {reachedEnd && hotspots.length > 0 && (
            <p className="dash-end-hint">
              已经到底了哦～
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
