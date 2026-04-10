import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Spin, Tag, Descriptions } from "antd";

const MERCHANT_API_BASE = "/api/merchant";
const TOKEN_KEY = "ai_decision_access_token";

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch {
    // 未登录或网络异常时允许页面降级渲染
  }
  return null;
};

export default function ProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const pid = Number(productId);
    if (!pid || isNaN(pid)) {
      setError("无效的商品ID");
      setLoading(false);
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setError("请先登录");
      setLoading(false);
      return;
    }
    fetch(`${MERCHANT_API_BASE.replace("/merchant", "/products")}/${pid}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`获取失败: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        setProduct(json?.data || json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [productId]);

  if (loading) {
    return (
      <s-page heading="商品详情">
        <s-section>
          <div className="dash-shell">
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Spin size="large" />
              <p style={{ marginTop: 16, color: "#666" }}>加载中...</p>
            </div>
          </div>
        </s-section>
      </s-page>
    );
  }

  if (error) {
    return (
      <s-page heading="商品详情">
        <s-section>
          <div className="dash-shell">
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <p style={{ color: "#ff4d4f", marginBottom: 16 }}>{error}</p>
              <Button onClick={() => navigate(-1)}>返回</Button>
            </div>
          </div>
        </s-section>
      </s-page>
    );
  }

  if (!product) return null;

  const mainImage = product.images?.[0]?.src || product.image?.src;
  const variantList = product.variants || [];
  const optionList = product.options || [];

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate(-1)} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>返回</span>
      </button>
      <s-page heading={`商品详情 - ${product.title || ""}`}>
        <s-section heading="基本信息">
          <div className="dash-shell dash-section-inner">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="商品名称">{product.title || "—"}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {product.status && <Tag color={product.status === "active" ? "green" : "default"}>{product.status}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="供应商">{product.vendor || "—"}</Descriptions.Item>
              <Descriptions.Item label="商品类型">{product.product_type || "—"}</Descriptions.Item>
              <Descriptions.Item label="商品标签" span={2}>
                {product.tags ? (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {product.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                ) : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{product.created_at || "—"}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{product.updated_at || "—"}</Descriptions.Item>
            </Descriptions>
          </div>
        </s-section>

        {/* 商品图片 */}
        {mainImage && (
          <s-section heading="商品图片">
            <div className="dash-shell dash-section-inner">
              <img
                src={mainImage}
                alt={product.title}
                style={{ maxWidth: 300, borderRadius: 8, border: "1px solid #f0f0f0" }}
              />
              {product.images && product.images.length > 1 && (
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  {product.images.map((img) => (
                    img.src && img.src !== mainImage ? (
                      <img
                        key={img.id}
                        src={img.src}
                        alt=""
                        style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4, border: "1px solid #f0f0f0" }}
                      />
                    ) : null
                  ))}
                </div>
              )}
            </div>
          </s-section>
        )}

        {/* 商品描述 */}
        {product.body_html && (
          <s-section heading="商品描述">
            <div className="dash-shell dash-section-inner">
              <div dangerouslySetInnerHTML={{ __html: product.body_html }} style={{ lineHeight: 1.8 }} />
            </div>
          </s-section>
        )}

        {/* 规格变体 */}
        {variantList.length > 0 && (
          <s-section heading={`规格变体（${variantList.length} 个）`}>
            <div className="dash-shell dash-section-inner">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #f0f0f0" }}>规格名称</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>价格</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>原价</th>
                    <th style={{ padding: "8px 12px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>SKU</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>库存</th>
                  </tr>
                </thead>
                <tbody>
                  {variantList.map((v) => (
                    <tr key={v.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "8px 12px" }}>{v.title || "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>
                        {v.price ? `$${v.price}` : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#999" }}>
                        {v.compare_at_price ? `$${v.compare_at_price}` : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#666" }}>{v.sku || "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        {v.inventory_quantity != null ? (
                          <Tag color={v.inventory_quantity > 10 ? "green" : v.inventory_quantity > 0 ? "orange" : "red"}>
                            {v.inventory_quantity}
                          </Tag>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-section>
        )}

        {/* 规格选项 */}
        {optionList.length > 0 && (
          <s-section heading="规格选项">
            <div className="dash-shell dash-section-inner">
              {optionList.map((opt) => (
                <div key={opt.id} style={{ marginBottom: 12 }}>
                  <strong style={{ marginRight: 8 }}>{opt.name}：</strong>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {opt.values.map((val) => (
                      <Tag key={val}>{val}</Tag>
                    ))}
                  </span>
                </div>
              ))}
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
