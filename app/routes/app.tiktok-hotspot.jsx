import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Empty, Input, message, Space, Spin } from "antd";
import { authFetch } from "../utils/auth-api";

const DEFAULT_TIKTOK_MAX_RESULTS = 20;
const DEFAULT_TIKTOK_COMMENTS_PER_POST = 3;

function normalizeHashtags(value) {
  return String(value || "")
    .split(/[\s,，#]+/)
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean);
}

function uniqueHashtags(tags) {
  return [...new Set(tags)];
}

function pickTrendList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  if (Array.isArray(json?.items)) return json.items;
  return [];
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

function tiktokRowKey(item, index) {
  if (item?.id != null && String(item.id).trim()) return String(item.id);
  return `${item?.title || "tiktok"}-${index}`;
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

  useEffect(() => {
    setDraft(hashtags.join(", "));
  }, [hashtags]);

  const loadTiktokHotspots = useCallback(async (nextHashtags) => {
    if (!nextHashtags.length) {
      setItems([]);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/v1/hotspot/tiktok/hashtag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hashtags: nextHashtags,
          max_results: DEFAULT_TIKTOK_MAX_RESULTS,
          comments_per_post: DEFAULT_TIKTOK_COMMENTS_PER_POST,
          sort: {
            sort_by: "diggs",
            sort_order: "desc",
            limit: DEFAULT_TIKTOK_MAX_RESULTS,
          },
        }),
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
                {hashtags.length ? `当前 hashtags：${hashtags.map((tag) => `#${tag}`).join("、")}` : "请输入 hashtags 获取 TikTok 热点"}
              </span>
              <Space.Compact style={{ width: 420, maxWidth: "100%" }}>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPressEnter={handleSearch}
                  placeholder="例如：skincare, beauty"
                />
                <Button type="primary" onClick={handleSearch} loading={loading}>
                  获取
                </Button>
              </Space.Compact>
            </div>

            {loading ? (
              <div className="dash-page-loading">
                <Spin size="large" />
              </div>
            ) : null}

            {!loading && error ? (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <p className="dash-text-error">加载失败：{error}</p>
                <Button onClick={() => loadTiktokHotspots(hashtags)}>重试</Button>
              </Space>
            ) : null}

            {!loading && !error && !hashtags.length ? (
              <Empty description="请输入 hashtags" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <p style={{ color: "var(--dash-muted)" }}>例如 skincare、beauty、fyp。</p>
              </Empty>
            ) : null}

            {!loading && !error && hashtags.length > 0 && items.length === 0 ? (
              <Empty description="暂无 TikTok 热点数据" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <p style={{ color: "var(--dash-muted)" }}>可以换一组 hashtag 后重试。</p>
              </Empty>
            ) : null}

            {!loading && !error && items.length > 0 ? (
              <div className="hotspot-table tiktok-hotspot-table">
                <div className="hotspot-table-header" role="row">
                  <span>标题</span>
                  <span>摘要</span>
                  <span>平台与时间</span>
                  <span>互动数据</span>
                  <span>原文</span>
                </div>
                <div className="hotspot-table-body">
                  {items.map((item, index) => {
                    const tagsStr = formatTags(item.tags);
                    return (
                      <div className="hotspot-table-body-group" key={tiktokRowKey(item, index)}>
                        <div
                          className={`hotspot-table-row ${index % 2 === 1 ? "hotspot-table-row--alt" : ""}`}
                          role="row"
                        >
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
                              {formatNumber(item.comment_count)} 评论 · {formatNumber(item.share_count)} 分享 · {formatNumber(item.collect_count)} 收藏
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
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
