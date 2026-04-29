import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Tag, Space, message, Input, Card, Spin, Modal, Descriptions } from "antd";
import { authFetch } from "../utils/auth-api";

const MERCHANT_API_BASE = "/api/v1/merchant";
/** 刷新后恢复已选热点、匹配结果、表单（无 URL 参数时） */
const MATCH_PAGE_STATE_KEY = "app_match_page_v1";

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  return tags.join(" · ");
}

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch {
    // 未登录或网络异常时允许页面降级渲染
  }
  return null;
};

export default function Match() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [hotspots, setHotspots] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [brandForm, setBrandForm] = useState({
    brandName: "",
    description: "",
    tone: "",
    mainlySoldProducts: "",
    audienceStr: "",
  });
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandUpdating, setBrandUpdating] = useState(false);
  const [brandEditOpen, setBrandEditOpen] = useState(false);
  const [brandDraft, setBrandDraft] = useState({
    brandName: "",
    description: "",
    tone: "",
    mainlySoldProducts: "",
    audienceStr: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const persistFromHotspots = (list, extra = {}) => {
      try {
        const raw = sessionStorage.getItem(MATCH_PAGE_STATE_KEY);
        const prev = raw ? JSON.parse(raw) : {};
        sessionStorage.setItem(
          MATCH_PAGE_STATE_KEY,
          JSON.stringify({
            ...prev,
            hotspots: list,
            ...extra,
          }),
        );
      } catch {
        // ignore
      }
    };

    const encodedList = searchParams.get("hotspots");
    const encodedSingle = searchParams.get("hotspot");
    try {
      if (encodedList) {
        const parsed = JSON.parse(decodeURIComponent(encodedList));
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHotspots(parsed);
          persistFromHotspots(parsed, { results: [], error: null });
          return;
        }
      }
      if (encodedSingle) {
        const parsedSingle = JSON.parse(decodeURIComponent(encodedSingle));
        const arr = parsedSingle ? [parsedSingle] : [];
        setHotspots(arr);
        persistFromHotspots(arr, { results: [], error: null });
        return;
      }
      const raw = sessionStorage.getItem(MATCH_PAGE_STATE_KEY);
      if (!raw) {
        navigate("/app/hotspot");
        return;
      }
      const data = JSON.parse(raw);
      if (!Array.isArray(data?.hotspots) || data.hotspots.length === 0) {
        navigate("/app/hotspot");
        return;
      }
      setHotspots(data.hotspots);
      if (Array.isArray(data.results)) setResults(data.results);
      if (typeof data.error === "string") setError(data.error);
    } catch {
      navigate("/app/hotspot");
    }
  }, [navigate, searchParams]);

  useEffect(() => {
    if (!hotspots.length) return;
    try {
      const raw = sessionStorage.getItem(MATCH_PAGE_STATE_KEY);
      const prev = raw ? JSON.parse(raw) : {};
      sessionStorage.setItem(
        MATCH_PAGE_STATE_KEY,
        JSON.stringify({
          ...prev,
          hotspots,
          results,
          brandForm,
          error: error ?? null,
        }),
      );
    } catch {
      // ignore
    }
  }, [hotspots, results, brandForm, error]);

  const loadUserInfo = useCallback(async () => {
    try {
      const res = await authFetch(`${MERCHANT_API_BASE}/info`);
      if (res.ok) {
        const json = await res.json();
        const userData = json?.data || json;
        setCurrentUser(userData);
        if (userData?.brand) {
          setBrandForm((f) => ({
            ...f,
            brandName: userData.brand?.name || f.brandName,
            description: userData.brand?.core_value || f.description,
            tone: userData.brand?.tone || f.tone,
            mainlySoldProducts:
              userData.brand?.mainly_sold_products ||
              userData.brand?.industry ||
              f.mainlySoldProducts,
          }));
        }
      }
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录后重试");
      }
    }
  }, [navigate]);

  // 与品牌编辑页一致：优先用已保存的 brand-info 回填表单
  const loadBrandInfo = useCallback(async () => {
    try {
      const res = await authFetch(`${MERCHANT_API_BASE}/brand-info`);
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      const brandData = json?.data || null;
      if (!brandData) return;
      setBrandForm((f) => ({
        ...f,
        brandName: brandData.name || f.brandName,
        description: brandData.core_value || f.description,
        tone: brandData.tone || f.tone,
        mainlySoldProducts:
          brandData.mainly_sold_products || f.mainlySoldProducts,
        audienceStr: Array.isArray(brandData.audience)
          ? brandData.audience.join(",")
          : f.audienceStr,
      }));
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录后重试");
      }
    }
  }, [navigate]);

  useEffect(() => {
    if (!hotspots.length) return;
    let cancelled = false;
    let storedBrandForm = null;
    try {
      const raw = sessionStorage.getItem(MATCH_PAGE_STATE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data?.brandForm && typeof data.brandForm === "object") {
        storedBrandForm = data.brandForm;
      }
    } catch {
      storedBrandForm = null;
    }
    const run = async () => {
      setBrandLoading(true);
      try {
        await loadUserInfo();
        if (!cancelled) await loadBrandInfo();
        if (!cancelled && storedBrandForm) {
          setBrandForm((f) => ({ ...f, ...storedBrandForm }));
        }
      } finally {
        if (!cancelled) setBrandLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [hotspots, loadBrandInfo, loadUserInfo]);

  const analyzedCount = useMemo(() => results.filter(Boolean).length, [results]);

  const parseAudienceInput = (str) => {
    const s = String(str || "").trim();
    if (!s) return [];
    return s
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
  };

  const buildBrandPayload = () => ({
    name: brandForm.brandName.trim(),
    core_value: brandForm.description.trim(),
    mainly_sold_products:
      brandForm.mainlySoldProducts.trim() ||
      currentUser?.brand?.mainly_sold_products ||
      currentUser?.brand?.industry ||
      "",
    tone: brandForm.tone.trim(),
    audience: parseAudienceInput(brandForm.audienceStr),
  });

  const openBrandEditor = () => {
    setBrandDraft({ ...brandForm });
    setBrandEditOpen(true);
  };

  const cancelBrandEditor = () => {
    setBrandEditOpen(false);
    setBrandDraft({ ...brandForm });
  };

  const confirmBrandEditor = async () => {
    if (!brandDraft.brandName.trim()) {
      message.warning("请填写品牌名称");
      return;
    }
    setBrandUpdating(true);
    try {
      const res = await authFetch(`${MERCHANT_API_BASE}/brand-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: brandDraft.brandName.trim(),
          core_value: brandDraft.description.trim(),
          mainly_sold_products: brandDraft.mainlySoldProducts.trim(),
          tone: brandDraft.tone.trim(),
          audience: parseAudienceInput(brandDraft.audienceStr),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.data?.message || json?.message || "保存品牌信息失败";
        message.error(detail);
        return;
      }
      setBrandForm({ ...brandDraft });
      setBrandEditOpen(false);
      message.success("品牌信息已更新");
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录后重试");
      } else {
        message.error(e instanceof Error ? e.message : "网络错误");
      }
    } finally {
      setBrandUpdating(false);
    }
  };

  const handleSubmit = async () => {
    if (!hotspots.length) {
      setError("请先选择热点");
      return;
    }
    if (!brandForm.brandName.trim()) {
      setError("请填写品牌名称");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResults([]);
    try {
      const res = await authFetch("/api/v1/hotspot/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trends: hotspots.map((hotspot) => ({
            title: hotspot.title || "",
            summary: hotspot.summary || hotspot.title || "",
            tags: Array.isArray(hotspot.tags) ? hotspot.tags : [],
            audience: Array.isArray(hotspot.audience) ? hotspot.audience : null,
          })),
          options: { use_llm: true },
          // 若后端 HotspotBatchMatchRequest 支持可选 brand 覆盖，将使用此处；否则需在后端增加该字段
          brand: buildBrandPayload(),
        }),
      });
      if (!res.ok) throw new Error(`请求失败: ${res.status}`);
      const json = await res.json();
      const items = Array.isArray(json)
        ? json
        : (Array.isArray(json?.data) ? json.data : []);
      setResults(items);
    } catch (err) {
      if (err instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(err.message)) {
        message.warning("请先登录或重新登录后重试");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const buildMergedHotspot = () => {
    const topHotspots = hotspots.slice(0, 5);
    const tags = Array.from(
      new Set(
        topHotspots.flatMap((item) =>
          Array.isArray(item.tags) ? item.tags : []
        )
      )
    ).slice(0, 8);
    const audience = Array.from(
      new Set(
        topHotspots.flatMap((item) =>
          Array.isArray(item.audience) ? item.audience : []
        )
      )
    ).slice(0, 8);
    const title =
      hotspots.length > 1
        ? `多热点整合营销主题（共 ${hotspots.length} 条）`
        : (topHotspots[0]?.title || "热点营销主题");
    const summary = topHotspots
      .map((item, index) => `${index + 1}. ${item.summary || item.title || ""}`)
      .filter(Boolean)
      .join("；");

    return {
      title,
      summary: summary || title,
      tags,
      audience,
    };
  };

  const buildMergedMatchResult = () => {
    const scores = results
      .map((item) => Number(item?.compatibility_score))
      .filter((score) => Number.isFinite(score));
    const avgScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;
    const recommendationSet = Array.from(
      new Set(results.map((item) => item?.recommendation).filter(Boolean))
    );
    const reasons = results
      .map((item) => item?.reason)
      .filter(Boolean)
      .slice(0, 3);
    const suggestions = results
      .map((item) => item?.suggestion)
      .filter(Boolean)
      .slice(0, 3);

    return {
      matchScore: avgScore,
      recommendationLevel: recommendationSet.join(" / ") || null,
      analysis: reasons.join("；") || null,
      marketingSuggestions: suggestions.join("；") || null,
      brandName: brandForm.brandName.trim(),
      slogan: brandForm.description.trim(),
      industry: brandForm.mainlySoldProducts.trim(),
      tone: brandForm.tone.trim(),
    };
  };

  const handleReGenerate = () => {
    const encodedHotspot = encodeURIComponent(
      JSON.stringify(buildMergedHotspot())
    );
    const encodedMatch = encodeURIComponent(
      JSON.stringify(buildMergedMatchResult())
    );
    navigate(`/app/generate?hotspot=${encodedHotspot}&match=${encodedMatch}`);
  };

  const handleBackToHotspot = () => {
    navigate("/app/hotspot");
  };

  if (!hotspots.length) {
    return (
      <s-page heading="匹配度分析">
        <s-section>
          <div className="dash-shell">
            <p className="dash-text-loading">正在加载热点数据...</p>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate("/app/hotspot")} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>返回热点列表</span>
      </button>
      <s-page heading="匹配度分析">
        <s-section heading="已选热点">
          <div className="dash-shell dash-section-inner">
            <div style={{ marginBottom: 12, color: "var(--dash-muted)" }}>
              共选择 {hotspots.length} 个热点
            </div>
            <div className="hotspot-table">
              <div className="hotspot-table-body">
                {hotspots.map((hotspot, index) => (
                  <div key={`${hotspot.id ?? hotspot.title ?? "hotspot"}-${index}`} className="hotspot-table-row" role="row">
                    <div className="hotspot-table-row__avatar" aria-hidden />
                    <div className="hotspot-table-row__col hotspot-table-row__col--title">
                      <span className="hotspot-table-row__title">
                        {index + 1}. {hotspot.title || "—"}
                      </span>
                      {formatTags(hotspot.tags) ? (
                        <span className="hotspot-table-row__sub">{formatTags(hotspot.tags)}</span>
                      ) : null}
                    </div>
                    <div className="hotspot-table-row__col hotspot-table-row__col--summary">
                      <span className="hotspot-table-row__text">{hotspot.summary || "—"}</span>
                    </div>
                    <div className="hotspot-table-row__col hotspot-table-row__col--meta">
                      <span>{hotspot.platform || "—"}</span>
                      <span className="hotspot-table-row__sub">{hotspot.publish_time || "—"}</span>
                      {hotspot.sentiment_label ? (
                        <span className="hotspot-table-row__sub">{hotspot.sentiment_label}</span>
                      ) : null}
                    </div>
                    <div className="hotspot-table-row__col hotspot-table-row__col--action">
                      <span className="hotspot-table-row__text">
                        {[
                          hotspot.view_count != null ? `${hotspot.view_count} 浏览` : null,
                          hotspot.likes != null ? `${hotspot.likes} 赞` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </s-section>

        <s-section heading="品牌信息">
          <div className="dash-shell dash-section-inner">
            <Card size="small" style={{ background: "#fafafa" }}>
              <p style={{ marginBottom: 12, color: "var(--dash-muted)", fontSize: 13 }}>
                默认从已保存的商户品牌信息回填。你可以点击按钮临时修改，仅影响本次批量匹配。
              </p>
              {brandLoading ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <Spin />
                  <p style={{ marginTop: 8, color: "var(--dash-muted)" }}>正在加载品牌信息...</p>
                </div>
              ) : (
                <>
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="品牌名称">
                      {brandForm.brandName || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                    </Descriptions.Item>
                    <Descriptions.Item label="品牌介绍">
                      {brandForm.description || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                    </Descriptions.Item>
                    <Descriptions.Item label="品牌风格">
                      {brandForm.tone || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                    </Descriptions.Item>
                    <Descriptions.Item label="主要售卖商品">
                      {brandForm.mainlySoldProducts || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                    </Descriptions.Item>
                    <Descriptions.Item label="目标受众（选填）">
                      {brandForm.audienceStr || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                    </Descriptions.Item>
                  </Descriptions>
                  <div style={{ marginTop: 12 }}>
                    <Button onClick={openBrandEditor}>修改品牌信息</Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        </s-section>

        <s-section heading="批量分析">
          <div className="dash-shell dash-section-inner">
            <div className="hotspot-form-card">
              {error ? <p className="hotspot-form-card__error">{error}</p> : null}
              <div className="hotspot-form-card__footer">
                <Space>
                  <Button
                    type="primary"
                    loading={submitting}
                    onClick={handleSubmit}
                    disabled={submitting || brandLoading}
                  >
                    开始批量分析
                  </Button>
                  <span style={{ color: "var(--dash-muted)" }}>
                    已分析 {analyzedCount}/{hotspots.length}
                  </span>
                </Space>
              </div>
            </div>
          </div>
        </s-section>

        {results.length > 0 && (
          <s-section heading="分析结果">
            <div className="dash-shell dash-section-inner">
              <div className="hotspot-table">
                <div className="hotspot-table-body">
                  {results.map((result, index) => {
                    const hotspot = hotspots[index] || {};
                    const score = result?.compatibility_score;
                    const recommendation = result?.recommendation;
                    return (
                      <div key={`${hotspot.id ?? hotspot.title ?? "hotspot"}-${index}`} className="hotspot-table-row" role="row">
                        <div className="hotspot-table-row__avatar" aria-hidden />
                        <div className="hotspot-table-row__col hotspot-table-row__col--title">
                          <span className="hotspot-table-row__title">{hotspot.title || `热点 ${index + 1}`}</span>
                          <span className="hotspot-table-row__sub">匹配结果</span>
                        </div>
                        <div className="hotspot-table-row__col hotspot-table-row__col--summary">
                          <span className="hotspot-table-row__text">{result?.reason || "—"}</span>
                        </div>
                        <div className="hotspot-table-row__col hotspot-table-row__col--meta">
                          <Space size={4} wrap>
                            {score != null ? <span className="result-score">{score}</span> : null}
                            {recommendation ? (
                              <Tag
                                color={
                                  recommendation === "强烈推荐"
                                    ? "green"
                                    : recommendation === "推荐"
                                    ? "blue"
                                    : "orange"
                                }
                              >
                                {recommendation}
                              </Tag>
                            ) : null}
                          </Space>
                        </div>
                        <div className="hotspot-table-row__col hotspot-table-row__col--action">
                          <span className="hotspot-table-row__text">{result?.suggestion || "—"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <Space>
                  <Button type="primary" onClick={handleReGenerate}>
                    基于多热点生成营销内容
                  </Button>
                  <Button onClick={handleBackToHotspot}>
                    返回热点
                  </Button>
                </Space>
              </div>
            </div>
          </s-section>
        )}
      </s-page>

      <Modal
        open={brandEditOpen}
        title="修改品牌信息"
        onCancel={cancelBrandEditor}
        onOk={confirmBrandEditor}
        confirmLoading={brandUpdating}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="brand-edit-form">
          <div className="brand-edit-form__row">
            <label className="brand-edit-form__label" htmlFor="match-brand-name-modal">
              品牌名称 <span className="brand-edit-form__required">*</span>
            </label>
            <Input
              id="match-brand-name-modal"
              value={brandDraft.brandName}
              onChange={(e) =>
                setBrandDraft((f) => ({ ...f, brandName: e.target.value }))
              }
              placeholder="请输入品牌名称"
              size="large"
            />
          </div>
          <div className="brand-edit-form__row">
            <label className="brand-edit-form__label" htmlFor="match-brand-desc-modal">
              品牌介绍
            </label>
            <Input.TextArea
              id="match-brand-desc-modal"
              value={brandDraft.description}
              onChange={(e) =>
                setBrandDraft((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="请输入品牌介绍"
              rows={3}
            />
          </div>
          <div className="brand-edit-form__row">
            <label className="brand-edit-form__label" htmlFor="match-brand-tone-modal">
              品牌风格
            </label>
            <Input
              id="match-brand-tone-modal"
              value={brandDraft.tone}
              onChange={(e) =>
                setBrandDraft((f) => ({ ...f, tone: e.target.value }))
              }
              placeholder="如：高端奢华、年轻活力、简约自然"
              size="large"
            />
          </div>
          <div className="brand-edit-form__row">
            <label className="brand-edit-form__label" htmlFor="match-brand-products-modal">
              主要售卖商品
            </label>
            <Input
              id="match-brand-products-modal"
              value={brandDraft.mainlySoldProducts}
              onChange={(e) =>
                setBrandDraft((f) => ({
                  ...f,
                  mainlySoldProducts: e.target.value,
                }))
              }
              placeholder="如：女装、家居、3C数码"
              size="large"
            />
          </div>
          <div className="brand-edit-form__row">
            <label className="brand-edit-form__label" htmlFor="match-brand-audience-modal">
              目标受众（选填）
            </label>
            <Input
              id="match-brand-audience-modal"
              value={brandDraft.audienceStr}
              onChange={(e) =>
                setBrandDraft((f) => ({ ...f, audienceStr: e.target.value }))
              }
              placeholder="多个用英文或中文逗号分隔"
              size="large"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
