import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Select, message, Card, Tag, Space } from "antd";
import { VideoCameraOutlined } from "@ant-design/icons";
import { authFetch } from "../utils/auth-api";

const MERCHANT_API_BASE = "/api/v1/merchant";
const PRODUCTS_API_BASE = "/api/v1/products";
const VIDEO_CHAT_BOOTSTRAP_KEY = "video_chat_bootstrap_v1";
/** 刷新后恢复热点 / 匹配结果 / 已选商品（无 URL 参数时） */
const GENERATE_PAGE_STATE_KEY = "app_generate_page_v1";
/** 本页已隐藏比例/时长/模式选择，提交时使用以下默认 */
const DEFAULT_GENERATION_DURATION_SEC = 5;
const DEFAULT_VIDEO_RATIO = "16:9";

function parseProductListResponse(json) {
  const rows = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.data?.items)
    ? json.data.items
    : Array.isArray(json?.items)
    ? json.items
    : [];
  return rows.map(normalizeProduct);
}

function normalizeProduct(raw) {
  if (!raw || typeof raw !== "object") return raw;

  // 兼容两类后端结构：
  // 1) Shopify 原始结构（id/title/images/variants）
  // 2) 精简结构（product_id/name/image_url/price）
  const id = raw.id ?? raw.product_id;
  const title = raw.title ?? raw.name ?? "";
  const bodyHtml = raw.body_html ?? raw.description ?? "";
  const fallbackPrice =
    raw.variants?.[0]?.price ??
    (raw.price != null ? String(raw.price) : undefined);
  const imageSrc = raw.images?.[0]?.src ?? raw.image?.src ?? raw.image_url ?? "";
  const variants = Array.isArray(raw.variants)
    ? raw.variants
    : fallbackPrice
    ? [{ id: `${id || "product"}-default`, title: "默认规格", price: String(fallbackPrice) }]
    : [];
  const images = Array.isArray(raw.images)
    ? raw.images
    : imageSrc
    ? [{ id: `${id || "product"}-image`, src: imageSrc }]
    : [];

  return {
    ...raw,
    id,
    title,
    body_html: bodyHtml,
    variants,
    images,
  };
}

function toSafePrice(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAudienceList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return null;
}

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch {
    // 未登录或网络异常时允许页面降级渲染
  }
  return null;
};

export default function Generate() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 接收从匹配页面传来的数据
  const [hotspot, setHotspot] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [brandInfo, setBrandInfo] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(undefined);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingProductDetail, setLoadingProductDetail] = useState(false);

  // 页面跳转状态
  const [submitting, setSubmitting] = useState(false);

  // 初始化：优先 URL，其次 sessionStorage（解决刷新丢 query / location.state）
  useEffect(() => {
    const persistSnapshot = (hotspotObj, matchObj, productId, product) => {
      try {
        sessionStorage.setItem(
          GENERATE_PAGE_STATE_KEY,
          JSON.stringify({
            hotspot: hotspotObj,
            matchResult: matchObj ?? null,
            selectedProductId: productId ?? null,
            selectedProduct: product ?? null,
          }),
        );
      } catch {
        // ignore
      }
    };

    const encoded = searchParams.get("hotspot");
    const matchStr = searchParams.get("match");
    if (encoded) {
      try {
        const h = JSON.parse(decodeURIComponent(encoded));
        setHotspot(h);
        let m = null;
        if (matchStr) {
          try {
            m = JSON.parse(decodeURIComponent(matchStr));
            setMatchResult(m);
          } catch {
            setMatchResult(null);
          }
        } else {
          setMatchResult(null);
        }
        persistSnapshot(h, m, null, null);
      } catch {
        navigate("/app/hotspot");
      }
      return;
    }

    try {
      const raw = sessionStorage.getItem(GENERATE_PAGE_STATE_KEY);
      if (!raw) {
        navigate("/app/hotspot");
        return;
      }
      const data = JSON.parse(raw);
      if (!data?.hotspot || typeof data.hotspot !== "object") {
        navigate("/app/hotspot");
        return;
      }
      setHotspot(data.hotspot);
      setMatchResult(data.matchResult ?? null);
      if (data.selectedProductId != null && data.selectedProductId !== "") {
        setSelectedProductId(data.selectedProductId);
      }
      if (data.selectedProduct && typeof data.selectedProduct === "object") {
        setSelectedProduct(normalizeProduct(data.selectedProduct));
      }
    } catch {
      navigate("/app/hotspot");
    }
  }, [navigate, searchParams]);

  useEffect(() => {
    if (!hotspot) return;
    try {
      sessionStorage.setItem(
        GENERATE_PAGE_STATE_KEY,
        JSON.stringify({
          hotspot,
          matchResult: matchResult ?? null,
          selectedProductId: selectedProductId ?? null,
          selectedProduct: selectedProduct ?? null,
        }),
      );
    } catch {
      // ignore
    }
  }, [hotspot, matchResult, selectedProductId, selectedProduct]);

  // 加载商品列表
  useEffect(() => {
    setLoadingProducts(true);
    authFetch(`${MERCHANT_API_BASE.replace("/merchant", "/products")}?limit=20`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.detail || json?.message || `获取商品失败: ${res.status}`);
        }
        return json;
      })
      .then((json) => {
        setProducts(parseProductListResponse(json));
      })
      .catch((e) => {
        if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
          message.warning("登录已过期，请重新登录后重试");
          return;
        }
        if (e instanceof Error && e.message) {
          message.error(e.message);
        }
        setProducts([]);
      })
      .finally(() => setLoadingProducts(false));
  }, [navigate]);

  // 加载品牌信息（BrandObject）
  useEffect(() => {
    authFetch(`${MERCHANT_API_BASE}/brand-info`)
      .then((res) => res.json())
      .then((json) => {
        const data = json?.data || json;
        if (data) {
          setBrandInfo(data);
        }
      })
      .catch(() => {});
  }, []);

  const loadProductDetail = async (productId, fallbackProduct = null) => {
    if (productId == null || productId === "") {
      setSelectedProduct(null);
      return;
    }

    setLoadingProductDetail(true);
    try {
      const res = await authFetch(`${PRODUCTS_API_BASE}/${encodeURIComponent(String(productId))}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.detail || json?.message || `获取商品详情失败: ${res.status}`);
      }
      setSelectedProduct(normalizeProduct(json?.data || json || fallbackProduct));
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录后重试");
        return;
      }
      if (fallbackProduct) {
        setSelectedProduct(fallbackProduct);
      }
      if (e instanceof Error && e.message) {
        message.warning(`商品详情读取失败，已使用列表数据：${e.message}`);
      }
    } finally {
      setLoadingProductDetail(false);
    }
  };

  const handleSubmit = () => {
    if (loadingProductDetail) {
      message.info("商品详情加载中，请稍候");
      return;
    }
    if (!selectedProduct?.id) {
      message.warning("请选择一个商品");
      return;
    }
    const productIdNum = Number(selectedProduct.id);
    if (!Number.isFinite(productIdNum)) {
      message.error("商品ID无效，请重新选择商品");
      return;
    }

    const variantPayload = Array.isArray(selectedProduct.variants) && selectedProduct.variants.length > 1
      ? selectedProduct.variants
          .map((v) => {
            const variantIdNum = Number(v.id ?? v.variant_id);
            if (!Number.isFinite(variantIdNum)) return null;
            return {
              variant_id: variantIdNum,
              name: v.title || v.name || "默认规格",
              price: toSafePrice(v.price),
              image_url: selectedProduct.images?.[0]?.src || selectedProduct.image_url || "",
            };
          })
          .filter(Boolean)
      : null;

    const brandPayload = brandInfo
      ? {
          name: String(brandInfo.name || matchResult?.brandName || "").trim(),
          core_value: String(brandInfo.core_value || matchResult?.slogan || "").trim(),
          mainly_sold_products: String(
            brandInfo.mainly_sold_products ||
            brandInfo.industry ||
            selectedProduct.product_type ||
            matchResult?.industry ||
            "通用消费品"
          ).trim(),
          tone: String(brandInfo.tone || matchResult?.tone || "现代、专业").trim(),
          audience: toAudienceList(brandInfo.audience),
        }
      : {
          name: String(matchResult?.brandName || "").trim(),
          core_value: String(matchResult?.slogan || "").trim(),
          mainly_sold_products: String(matchResult?.industry || selectedProduct.product_type || "通用消费品").trim(),
          tone: String(matchResult?.tone || "现代、专业").trim(),
          audience: null,
        };

    const productPayload = {
      product_id: productIdNum,
      name: selectedProduct.title || "",
      description: selectedProduct.body_html || "",
      price: toSafePrice(selectedProduct.variants?.[0]?.price),
      image_url: selectedProduct.images?.[0]?.src || "",
      inventory: Number.isFinite(Number(selectedProduct.inventory)) ? Number(selectedProduct.inventory) : 0,
      variants: variantPayload,
    };

    const marketingFromHotspot =
      typeof hotspot?.marketing_suggestion === "string" ? hotspot.marketing_suggestion.trim() : "";
    const marketingFromMatch =
      typeof matchResult?.marketingSuggestions === "string"
        ? matchResult.marketingSuggestions.trim()
        : "";
    const marketingSuggestion = marketingFromHotspot || marketingFromMatch || "";

    const createPayload = {
      trend: {
        title: hotspot?.title || "",
        summary: hotspot?.summary || hotspot?.title || "",
        tags: Array.isArray(hotspot?.tags) ? hotspot.tags : [],
        audience: Array.isArray(hotspot?.audience) ? hotspot.audience : null,
        ...(marketingSuggestion ? { marketing_suggestion: marketingSuggestion } : {}),
      },
      brand: brandPayload,
      product: productPayload,
      user_input: `围绕热点「${hotspot?.title || "当前热点"}」制作约 ${DEFAULT_GENERATION_DURATION_SEC} 秒的营销视频`,
      generation_mode: "multimodal_reference",
      media_assets: null,
      config_params: {
        resolution: "720p",
        ratio: DEFAULT_VIDEO_RATIO,
        language: "zh",
        watermark: false,
        generate_audio: true,
      },
    };

    setSubmitting(true);
    try {
      const bootstrap = {
        source: "generate",
        createdAt: Date.now(),
        title: `${selectedProduct.title || "商品"} · ${hotspot?.title || "热点视频"}`,
        createPayload,
        videoParams: {
          resolution: "720p",
          ratio: DEFAULT_VIDEO_RATIO,
          watermark: false,
          generateAudio: true,
          generationMode: "multimodal_reference",
          referenceUsageDescription: "",
          responseLang: "zh",
          firstFrameList: [],
          lastFrameList: [],
        },
      };
      sessionStorage.setItem(VIDEO_CHAT_BOOTSTRAP_KEY, JSON.stringify(bootstrap));
      navigate("/app/video-chat", {
        state: {
          generateBootstrap: bootstrap,
        },
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "跳转失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (!hotspot) {
    return (
      <s-page heading="营销内容生成">
        <s-section>
          <div className="dash-shell">
            <p className="dash-text-loading">正在加载...</p>
          </div>
        </s-section>
      </s-page>
    );
  }

  const productOptions = products.map((p) => ({
    value: p.id,
    label: (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {p.images?.[0]?.src ? (
          <img src={p.images[0].src} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4 }} />
        ) : (
          <div style={{ width: 32, height: 32, background: "#f0f0f0", borderRadius: 4 }} />
        )}
        <span>{p.title}</span>
        {p.variants?.[0]?.price && <span style={{ color: "#999" }}>${p.variants[0].price}</span>}
      </div>
    ),
  }));

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate("/app/hotspot")} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>返回热点列表</span>
      </button>
      <s-page heading="营销内容生成">
        {/* 热点信息 */}
        <s-section heading="热点信息">
          <div className="dash-shell dash-section-inner">
            <Card size="small" style={{ background: "#fafafa" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18 }}>
                  {hotspot.sentiment_label === "正面" ? "🟢" : hotspot.sentiment_label === "负面" ? "🔴" : "🟡"}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{hotspot.title}</div>
                  <div style={{ color: "#666", fontSize: 13 }}>{hotspot.summary}</div>
                </div>
                {hotspot.tags?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 200 }}>
                    {hotspot.tags.slice(0, 3).map((t) => (
                      <Tag key={t}>#{t}</Tag>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </s-section>

        {/* 匹配结果 */}
        {matchResult && matchResult.matchScore != null && (
          <s-section heading="匹配分析结果">
            <div className="dash-shell dash-section-inner">
              <Card size="small">
                <Space size="large" wrap>
                  <div>
                    <span style={{ color: "#999", fontSize: 13 }}>契合度 </span>
                    <span style={{ fontWeight: 700, fontSize: 20, color: "#1890ff" }}>{matchResult.matchScore}</span>
                    <span style={{ color: "#999" }}> / 100</span>
                  </div>
                  {matchResult.recommendationLevel && (
                    <Tag
                      color={
                        matchResult.recommendationLevel === "强烈推荐"
                          ? "green"
                          : matchResult.recommendationLevel === "推荐"
                          ? "blue"
                          : "orange"
                      }
                    >
                      {matchResult.recommendationLevel}
                    </Tag>
                  )}
                </Space>
                {matchResult.analysis && (
                  <div style={{ marginTop: 8, color: "#444", fontSize: 13 }}>
                    <strong>分析：</strong>{matchResult.analysis}
                  </div>
                )}
                {matchResult.marketingSuggestions && (
                  <div style={{ marginTop: 4, color: "#444", fontSize: 13 }}>
                    <strong>建议：</strong>{matchResult.marketingSuggestions}
                  </div>
                )}
              </Card>
            </div>
          </s-section>
        )}

        {/* 生成配置 */}
        <s-section heading="生成配置">
          <div className="dash-shell dash-section-inner">
            <div className="ant-form-stack">
              <div className="ant-form-row">
                <label className="ant-form-label" htmlFor="select-product">选择商品</label>
                <Select
                  id="select-product"
                  placeholder="请选择要推广的商品"
                  value={selectedProductId}
                  onChange={(id) => {
                    const p = products.find((pr) => pr.id === id);
                    setSelectedProductId(id);
                    setSelectedProduct(p || null);
                    loadProductDetail(id, p || null);
                  }}
                  options={productOptions}
                  loading={loadingProducts || loadingProductDetail}
                  showSearch
                  filterOption={(input, option) =>
                    option.label.props.children[1]?.props?.children
                      ?.toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ marginTop: 16 }}>
                <Button
                  type="primary"
                  size="large"
                  loading={submitting}
                  onClick={handleSubmit}
                  disabled={!selectedProduct || loadingProductDetail}
                  icon={<VideoCameraOutlined />}
                >
                  开始生成
                </Button>
              </div>
            </div>
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
