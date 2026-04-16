import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Input, Select, Upload, message, Spin, Card, Tag, Space, Divider } from "antd";
import { UploadOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { authFetch } from "../utils/auth-api";

const MERCHANT_API_BASE = "/api/merchant";
const PRODUCTS_API_BASE = "/api/products";
const GENERATE_API_BASE = "/api/generate";
const CONTENT_API_BASE = "/api/content";

function parseProductListResponse(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  if (Array.isArray(json?.items)) return json.items;
  return [];
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

  // 生成配置
  const [generationType, setGenerationType] = useState("text_to_video");
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState("16:9");
  const [userPrompt, setUserPrompt] = useState("");
  const [imageUrls, setImageUrls] = useState([]);
  const [uploadingImage, setUploadingImage] = useState(false);

  // 生成状态
  const [submitting, setSubmitting] = useState(false);
  const [taskResult, setTaskResult] = useState(null);
  const [pollingTaskId, setPollingTaskId] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);

  // 初始化：从 URL 参数解析热点和匹配结果
  useEffect(() => {
    const encoded = searchParams.get("hotspot");
    const matchStr = searchParams.get("match");
    if (!encoded) {
      navigate("/app/hotspot");
      return;
    }
    try {
      setHotspot(JSON.parse(decodeURIComponent(encoded)));
    } catch {
      navigate("/app/hotspot");
      return;
    }
    if (matchStr) {
      try {
        setMatchResult(JSON.parse(decodeURIComponent(matchStr)));
      } catch {
        // ignore
      }
    }
  }, [navigate, searchParams]);

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
          message.warning("登录已过期，请重新登录");
          navigate("/app");
          return;
        }
        if (e instanceof Error && e.message) {
          message.error(e.message);
        }
        setProducts([]);
      })
      .finally(() => setLoadingProducts(false));
  }, [navigate]);

  // 加载品牌信息
  useEffect(() => {
    authFetch(`${MERCHANT_API_BASE}/info`)
      .then((res) => res.json())
      .then((json) => {
        const data = json?.data || json;
        if (data?.brand) {
          setBrandInfo(data.brand);
        }
      })
      .catch(() => {});
  }, []);

  // 轮询任务状态
  useEffect(() => {
    if (!pollingTaskId) return;
    const poll = async () => {
      try {
        const res = await authFetch(`${GENERATE_API_BASE}/video-task-status/${pollingTaskId}`);
        const json = await res.json();
        const data = json?.data || json;
        setTaskStatus(data?.status || "unknown");
        if (data?.status === "succeeded") {
          setTaskResult(data);
          setPollingTaskId(null);
        } else if (["failed", "cancelled"].includes(data?.status)) {
          setTaskResult({ error: data?.error?.message || "任务失败" });
          setPollingTaskId(null);
        }
      } catch (e) {
        if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
          setTaskResult({ error: "登录已过期，请重新登录后再试" });
          setPollingTaskId(null);
          return;
        }
        // 继续轮询
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [pollingTaskId]);

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
      setSelectedProduct(json?.data || json || fallbackProduct);
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录");
        navigate("/app");
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

  // 上传参考图
  const handleUpload = async (file) => {
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await authFetch(`${CONTENT_API_BASE}/upload-reference-image`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json?.detail || "上传失败");
        return false;
      }
      const imageUrl = json?.data?.image_url || "";
      if (imageUrl) {
        setImageUrls((prev) => [...prev, imageUrl]);
        message.success("图片上传成功");
      }
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录");
        navigate("/app");
      } else {
        message.error(e instanceof Error ? e.message : "上传失败");
      }
    } finally {
      setUploadingImage(false);
    }
    return false; // 阻止默认上传
  };

  // 移除已上传图片
  const handleRemoveImage = (url) => {
    setImageUrls((prev) => prev.filter((u) => u !== url));
  };

  // 提交生成任务
  const handleSubmit = async () => {
    if (loadingProductDetail) {
      message.info("商品详情加载中，请稍候");
      return;
    }
    if (!selectedProduct?.id) {
      message.warning("请选择一个商品");
      return;
    }
    if (generationType !== "text_to_video" && imageUrls.length === 0) {
      message.warning("图生视频模式需要上传至少一张参考图");
      return;
    }
    // 组装请求数据
    const payload = {
      trendObject: {
        title: hotspot?.title || "",
        summary: hotspot?.summary || hotspot?.title || "",
        tags: Array.isArray(hotspot?.tags) ? hotspot.tags : [],
        audience: Array.isArray(hotspot?.audience) ? hotspot.audience : null,
      },
      brandObject: brandInfo
        ? {
            name: brandInfo.name || "",
            core_value: brandInfo.core_value || "",
            industry: brandInfo.industry || "",
            tone: brandInfo.tone || "",
            audience: brandInfo.audience ? (Array.isArray(brandInfo.audience) ? brandInfo.audience : brandInfo.audience.split(",")) : null,
          }
        : {
            name: matchResult?.brandName || "",
            core_value: matchResult?.slogan || "",
            industry: matchResult?.industry || "",
            tone: matchResult?.tone || "",
            audience: null,
          },
      productObject: {
        product_id: selectedProduct.id,
        name: selectedProduct.title || "",
        description: selectedProduct.body_html || "",
        price: selectedProduct.variants?.[0]?.price || "0",
        image_url: selectedProduct.images?.[0]?.src || "",
        inventory: 0,
        variants: null,
      },
      generation_type: generationType,
      duration: duration,
      ratio: ratio,
      user_prompt: userPrompt.trim() || null,
      image_urls: imageUrls.length > 0 ? imageUrls : null,
      watermark: false,
    };

    setSubmitting(true);
    try {
      const res = await authFetch(`${GENERATE_API_BASE}/trend-product-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json?.detail || "提交失败");
        return;
      }
      const taskId = json?.data?.id;
      if (taskId) {
        message.loading("任务已提交，正在生成视频...", 2);
        setPollingTaskId(taskId);
      } else {
        message.error("未返回任务ID");
      }
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录");
        navigate("/app");
      } else {
        message.error(e instanceof Error ? e.message : "网络错误");
      }
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

              <Divider style={{ margin: "12px 0" }} />

              <div className="ant-form-row">
                <span className="ant-form-label">生成模式</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { value: "text_to_video", label: "文生视频", desc: "纯文字生成视频" },
                    { value: "image_to_video", label: "图生视频", desc: "上传图片生成视频" },
                    { value: "ref_to_video", label: "参考图生视频", desc: "多张参考图生成视频" },
                  ].map((opt) => (
                    <Card
                      key={opt.value}
                      size="small"
                      hoverable
                      onClick={() => setGenerationType(opt.value)}
                      style={{
                        cursor: "pointer",
                        border: generationType === opt.value ? "2px solid #1890ff" : "1px solid #f0f0f0",
                        width: 140,
                      }}
                    >
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontWeight: 600 }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{opt.desc}</div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              {(generationType === "image_to_video" || generationType === "ref_to_video") && (
                <div className="ant-form-row">
                  <span className="ant-form-label">上传参考图</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    {imageUrls.map((url) => (
                      <div key={url} style={{ position: "relative" }}>
                        <img
                          src={url}
                          alt="参考图"
                          style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #f0f0f0" }}
                        />
                        <Button
                          type="text"
                          size="small"
                          danger
                          onClick={() => handleRemoveImage(url)}
                          style={{ position: "absolute", top: -8, right: -8, padding: 0 }}
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                    <Upload beforeUpload={handleUpload} showUploadList={false} accept="image/jpeg,image/png,image/webp">
                      <Button icon={<UploadOutlined />} loading={uploadingImage}>
                        {imageUrls.length === 0 ? "上传图片" : "继续添加"}
                      </Button>
                    </Upload>
                  </div>
                  <div style={{ fontSize: 12, color: "#999" }}>
                    支持 JPG、PNG、WebP 格式，{generationType === "ref_to_video" ? "建议上传 2~4 张参考图" : "至少上传 1 张图片"}
                  </div>
                </div>
              )}

              <div className="ant-form-row">
                <label className="ant-form-label" htmlFor="select-ratio">视频比例</label>
                <Select
                  id="select-ratio"
                  value={ratio}
                  onChange={setRatio}
                  options={[
                    { value: "16:9", label: "16:9 横版" },
                    { value: "9:16", label: "9:16 竖版（推荐社交媒体）" },
                    { value: "1:1", label: "1:1 方形" },
                  ]}
                  style={{ width: 220 }}
                />
              </div>

              <div className="ant-form-row">
                <label className="ant-form-label" htmlFor="select-duration">视频时长</label>
                <Select
                  id="select-duration"
                  value={duration}
                  onChange={setDuration}
                  options={[
                    { value: 5, label: "5 秒" },
                    { value: 10, label: "10 秒" },
                    { value: 12, label: "12 秒（最长）" },
                  ]}
                  style={{ width: 160 }}
                />
              </div>

              <div className="ant-form-row">
                <label className="ant-form-label ant-form-label--opt" htmlFor="input-prompt">补充描述（选填）</label>
                <Input.TextArea
                  id="input-prompt"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="补充你想要的视频风格、内容要求等，例如：适合抖音风格、有节奏感的背景音乐"
                  rows={2}
                />
              </div>

              <div style={{ marginTop: 16 }}>
                <Button
                  type="primary"
                  size="large"
                  loading={submitting || !!pollingTaskId}
                  onClick={handleSubmit}
                  disabled={!selectedProduct || loadingProductDetail || (generationType !== "text_to_video" && imageUrls.length === 0)}
                  icon={<VideoCameraOutlined />}
                >
                  {pollingTaskId ? `生成中... ${taskStatus || ""}` : "开始生成"}
                </Button>
              </div>
            </div>
          </div>
        </s-section>

        {/* 生成结果 */}
        {taskResult && (
          <s-section heading="生成结果">
            <div className="dash-shell dash-section-inner">
              {taskResult.error ? (
                <Card size="small" style={{ background: "#fff2f0", border: "1px solid #ffccc7" }}>
                  <div style={{ color: "#ff4d4f" }}>
                    <strong>生成失败：</strong>
                    {taskResult.error}
                  </div>
                </Card>
              ) : taskResult.content?.video_url ? (
                <Card size="small">
                  <div style={{ marginBottom: 12 }}>
                    <Tag color="green">生成成功</Tag>
                    <span style={{ color: "#666", marginLeft: 8 }}>视频地址（有效期 24 小时，请及时保存）</span>
                  </div>
                  <video
                    controls
                    src={taskResult.content.video_url}
                    style={{ width: "100%", maxWidth: 640, borderRadius: 8 }}
                  >
                    <track kind="captions" src="" default />
                  </video>
                  <div style={{ marginTop: 12 }}>
                    <a href={taskResult.content.video_url} target="_blank" rel="noopener noreferrer">
                      <Button>在新窗口打开</Button>
                    </a>
                    <Button style={{ marginLeft: 8 }} onClick={() => setTaskResult(null)}>
                      重新生成
                    </Button>
                  </div>
                </Card>
              ) : pollingTaskId ? (
                <Card size="small">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Spin size="small" />
                    <div>
                      <div style={{ fontWeight: 600 }}>视频生成中，请稍候...</div>
                      <div style={{ color: "#666", fontSize: 13 }}>
                        当前状态：<Tag>{taskStatus}</Tag>
                        <span style={{ marginLeft: 8 }}>预计需要 1~3 分钟</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ) : null}
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
