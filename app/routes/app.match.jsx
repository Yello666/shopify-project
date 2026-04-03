import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
 import { Button, Input, Select, Tag, Space } from "antd";

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  return tags.join(" · ");
}

function formatAudience(audience) {
  if (!Array.isArray(audience) || audience.length === 0) return null;
  return audience.join("、");
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

  const [hotspot, setHotspot] = useState(null);
  const [form, setForm] = useState({
    brandName: "",
    industry: "",
    tone: "",
    slogan: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const encoded = searchParams.get("hotspot");
    if (!encoded) {
      navigate("/app/hotspot");
      return;
    }
    try {
      setHotspot(JSON.parse(decodeURIComponent(encoded)));
    } catch {
      navigate("/app/hotspot");
    }
  }, [navigate, searchParams]);

  const updateForm = (key, value) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!hotspot) return;
    if (!form.brandName.trim() || !form.industry.trim() || !(form.tone && form.tone.length > 0)) {
      setError("请填写品牌名称、行业/品类与品牌调性");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/hotspot/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            trend: {
              title: hotspot.title || "",
              summary: hotspot.summary || hotspot.title || "",
              tags: Array.isArray(hotspot.tags) ? hotspot.tags : [],
              audience: Array.isArray(hotspot.audience) ? hotspot.audience : null,
            },
            brand: {
              name: form.brandName.trim(),
              core_value: form.slogan.trim(),
              industry: form.industry.trim(),
              tone: Array.isArray(form.tone) ? form.tone.join(", ") : (form.tone || "").trim(),
              audience: null,
            },
            options: { use_llm: true },
          },
        ]),
      });
      if (!res.ok) throw new Error(`请求失败: ${res.status}`);
      const json = await res.json();
      const items = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
      const first = items[0] || {};
      setResult({
        matchScore: first.compatibility_score ?? null,
        recommendationLevel: first.recommendation ?? null,
        analysis: first.reason ?? null,
        marketingSuggestions: first.suggestion ?? null,
        contentIdeas: null,
        hashtags: null,
        _raw: first,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReGenerate = () => {
    alert("正在重新生成营销内容……");
  };

  const handleBackToHotspot = () => {
    navigate("/app/hotspot");
  };

  if (!hotspot) {
    return (
      <s-page heading="匹配度分析">
        <s-section>
          <div className="dash-shell">
            <p className="dash-text-loading">正在加载热点数据……</p>
          </div>
        </s-section>
      </s-page>
    );
  }

  const tagsStr = formatTags(hotspot.tags);
  const audienceStr = formatAudience(hotspot.audience);
  const viewsLikes = [
    hotspot.view_count != null ? `${hotspot.view_count} 浏览` : null,
    hotspot.likes != null ? `${hotspot.likes} 赞` : null,
  ].filter(Boolean).join(" · ");

  const hotspotExtraParts = [];
  if (hotspot.risk_category && hotspot.risk_category !== "NONE") {
    hotspotExtraParts.push(`风险：${hotspot.risk_category}`);
  }
  if (hotspot.warning_message) {
    hotspotExtraParts.push(hotspot.warning_message);
  }
  if (hotspot.sentiment_score != null && hotspot.sentiment_score !== 0) {
    hotspotExtraParts.push(`情感分：${hotspot.sentiment_score}`);
  }
  if (audienceStr) {
    hotspotExtraParts.push(`受众：${audienceStr}`);
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
        {/* ── 热点信息 ─────────────────────────────────────────────── */}
        <s-section heading="热点信息">
          <div className="dash-shell dash-section-inner">
            <div className="hotspot-table">
              <div className="hotspot-table-body">
                <div className="hotspot-table-row" role="row">
                  <div className="hotspot-table-row__avatar" aria-hidden />
                  <div className="hotspot-table-row__col hotspot-table-row__col--title">
                    <span className="hotspot-table-row__title">{hotspot.title || "—"}</span>
                    {tagsStr ? (
                      <span className="hotspot-table-row__sub">{tagsStr}</span>
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
                    <span className="hotspot-table-row__text">{viewsLikes || "—"}</span>
                  </div>
                </div>
                {hotspotExtraParts.length > 0 || hotspot.jump_url ? (
                  <div className="hotspot-table-row-extra">
                    {hotspotExtraParts.length > 0 && (
                      <span>{hotspotExtraParts.join(" ｜ ")}</span>
                    )}
                    {hotspot.jump_url && (
                      <div style={{ marginTop: hotspotExtraParts.length ? "0.35rem" : 0 }}>
                        <a href={hotspot.jump_url} target="_blank" rel="noopener noreferrer">
                          查看原文链接
                        </a>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </s-section>

        {/* ── 品牌信息表单 ─────────────────────────────────────────── */}
        <s-section heading="填写品牌信息">
          <div className="dash-shell dash-section-inner">
            <div className="hotspot-form-card">
              <div className="hotspot-form-card__fields">
                <div className="hotspot-form-card__row">
                  <label className="hotspot-form-card__label" htmlFor="match-brand-name">
                    品牌名称 <span className="hotspot-form-card__required">*</span>
                  </label>
                  <Input
                    id="match-brand-name"
                    value={form.brandName}
                    onChange={(e) => updateForm("brandName", e.target.value)}
                    placeholder="请输入品牌名称"
                  />
                </div>
                <div className="hotspot-form-card__row">
                  <label className="hotspot-form-card__label" htmlFor="match-industry">
                    行业/品类 <span className="hotspot-form-card__required">*</span>
                  </label>
                  <Input
                    id="match-industry"
                    value={form.industry}
                    onChange={(e) => updateForm("industry", e.target.value)}
                    placeholder="如：女装、家居、3C数码"
                  />
                </div>
                <div className="hotspot-form-card__row">
                  <label className="hotspot-form-card__label" htmlFor="match-tone">
                    品牌调性 <span className="hotspot-form-card__required">*</span>
                  </label>
                  <Select
                    id="match-tone"
                    value={form.tone || undefined}
                    onChange={(v) => updateForm("tone", v)}
                    placeholder="请选择或输入品牌调性"
                    mode="tags"
                    style={{ width: "100%" }}
                    options={[
                      { value: "年轻活力", label: "年轻活力" },
                      { value: "高端奢华", label: "高端奢华" },
                      { value: "简约自然", label: "简约自然" },
                      { value: "活力运动", label: "活力运动" },
                      { value: "温馨居家", label: "温馨居家" },
                      { value: "专业可信", label: "专业可信" },
                    ]}
                  />
                </div>
                <div className="hotspot-form-card__row">
                  <label className="hotspot-form-card__label hotspot-form-card__label--opt" htmlFor="match-slogan">
                    品牌slogan（选填）
                  </label>
                  <Input
                    id="match-slogan"
                    value={form.slogan}
                    onChange={(e) => updateForm("slogan", e.target.value)}
                    placeholder="请输入品牌slogan或核心价值"
                  />
                </div>
              </div>
              {error ? (
                <p className="hotspot-form-card__error">{error}</p>
              ) : null}
              <div className="hotspot-form-card__footer">
                <Button type="primary" loading={submitting} onClick={handleSubmit} disabled={submitting}>
                  开始分析
                </Button>
              </div>
            </div>
          </div>
        </s-section>

        {/* ── 分析结果 ─────────────────────────────────────────────── */}
        {result && (
          <s-section heading="分析结果">
            <div className="dash-shell dash-section-inner">
              <div className="hotspot-table">
                <div className="hotspot-table-body">
                  <div className="hotspot-table-row" role="row">
                    <div className="hotspot-table-row__avatar" aria-hidden />
                    <div className="hotspot-table-row__col hotspot-table-row__col--meta">
                      <Space size={4} wrap>
                        {result.matchScore != null && (
                          <span className="result-score">{result.matchScore}</span>
                        )}
                        {result.recommendationLevel && (
                          <Tag
                            color={
                              result.recommendationLevel === "强烈推荐"
                                ? "green"
                                : result.recommendationLevel === "推荐"
                                ? "blue"
                                : "orange"
                            }
                          >
                            {result.recommendationLevel}
                          </Tag>
                        )}
                      </Space>
                    </div>
                    <div className="hotspot-table-row__col hotspot-table-row__col--summary">
                      {result.analysis && (
                        <span className="hotspot-table-row__text">{result.analysis}</span>
                      )}
                    </div>
                    <div className="hotspot-table-row__col hotspot-table-row__col--meta">
                      {result.marketingSuggestions && (
                        <span className="hotspot-table-row__text">{result.marketingSuggestions}</span>
                      )}
                    </div>
                    <div className="hotspot-table-row__col hotspot-table-row__col--action">
                      {["强烈推荐", "推荐"].includes(result.recommendationLevel) ? (
                        <Button type="primary" onClick={handleReGenerate} className="hotspot-table-row__btn--full">
                          立即生成
                        </Button>
                      ) : (
                        <Space size={4} wrap>
                          <Button onClick={handleReGenerate}>仍要生成</Button>
                          <Button onClick={handleBackToHotspot}>返回热点</Button>
                        </Space>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </s-section>
        )}
      </s-page>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
