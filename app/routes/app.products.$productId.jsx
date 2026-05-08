import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  Button,
  Spin,
  Tag,
  Descriptions,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Popconfirm,
  message,
  Alert,
} from "antd";
import { authFetch } from "../utils/auth-api";
import { ProductImageUrlField } from "../components/ProductImageUrlField";

const MERCHANT_INFO_URL = "/api/v1/merchant/info";
const PRODUCTS_API_BASE = "/api/v1/products";
const LOCAL_PRODUCTS_BASE = "/api/v1/local-products";

const STATUS_OPTIONS = [
  { value: "active", label: "上架 active" },
  { value: "draft", label: "草稿 draft" },
  { value: "archived", label: "归档 archived" },
];

function normalizeShopifyProduct(raw) {
  if (!raw || typeof raw !== "object") return raw;

  const id = raw.id ?? raw.product_id;
  const title = raw.title ?? raw.name ?? "";
  const bodyHtml = raw.body_html ?? raw.description ?? "";
  const imageSrc = raw.images?.[0]?.src ?? raw.image?.src ?? raw.image_url ?? "";
  const variants = Array.isArray(raw.variants)
    ? raw.variants
    : raw.price != null
    ? [{ id: `${id || "product"}-default`, title: "默认规格", price: String(raw.price) }]
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
    _plainDescription: false,
    variants,
    images,
    image: raw.image ?? (imageSrc ? { src: imageSrc } : undefined),
    vendor: raw.vendor ?? "",
    product_type: raw.product_type ?? "",
    status: raw.status ?? "",
    tags: raw.tags ?? "",
  };
}

/** 本地商品 API 转详情页统一结构 */
function normalizeLocalProduct(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const id = raw.id;
  const title = raw.title ?? "";
  const desc = raw.description ?? "";
  const imageSrc = raw.image_url ?? "";
  return {
    ...raw,
    id,
    title,
    body_html: desc,
    _plainDescription: true,
    vendor: "—",
    product_type: raw.product_type ?? "",
    status: raw.status ?? "",
    tags: "",
    variants: [
      {
        id: `${id}-default`,
        title: "默认规格",
        price: raw.price != null ? String(raw.price) : "",
        compare_at_price:
          raw.compare_at_price != null ? String(raw.compare_at_price) : undefined,
        inventory_quantity: raw.inventory ?? 0,
      },
    ],
    images: imageSrc ? [{ id: `${id}-img`, src: imageSrc }] : [],
    image: imageSrc ? { src: imageSrc } : undefined,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

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
  const [accountType, setAccountType] = useState(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSubmitting, setEditorSubmitting] = useState(false);
  const [form] = Form.useForm();

  const isStandalone = accountType === "standalone";
  const pid = Number(productId);

  const loadDetail = useCallback(async () => {
    if (!pid || Number.isNaN(pid)) {
      setError("无效的商品ID");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const mRes = await authFetch(MERCHANT_INFO_URL);
      const mJson = await mRes.json().catch(() => ({}));
      const acc = (mJson?.data ?? mJson)?.account_type || "shopify";
      setAccountType(acc);

      const isSt = acc === "standalone";
      const url = isSt ? `${LOCAL_PRODUCTS_BASE}/${pid}` : `${PRODUCTS_API_BASE}/${pid}`;
      const pRes = await authFetch(url);
      const pJson = await pRes.json().catch(() => ({}));
      if (!pRes.ok) {
        throw new Error(pJson?.data?.message || pJson?.message || pJson?.detail || `获取失败: ${pRes.status}`);
      }
      const raw = pJson?.data ?? pJson;
      setProduct(isSt ? normalizeLocalProduct(raw) : normalizeShopifyProduct(raw));
    } catch (err) {
      if (err?.message === "AUTH_REQUIRED" || err?.message === "AUTH_EXPIRED") {
        setError("登录已过期，请重新登录");
      } else {
        setError(err.message || "加载失败");
      }
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const openEdit = () => {
    if (!product || !isStandalone) return;
    form.setFieldsValue({
      title: product.title,
      description: product._plainDescription ? product.body_html : "",
      price: product.variants?.[0]?.price != null ? Number(product.variants[0].price) : 0,
      compare_at_price:
        product.variants?.[0]?.compare_at_price != null
          ? Number(product.variants[0].compare_at_price)
          : undefined,
      image_url: product.images?.[0]?.src ?? "",
      inventory: product.variants?.[0]?.inventory_quantity ?? 0,
      product_type: product.product_type ?? "",
      status: product.status || "active",
    });
    setEditorOpen(true);
  };

  const submitEdit = async () => {
    try {
      const values = await form.validateFields();
      setEditorSubmitting(true);
      const payload = {
        title: values.title?.trim(),
        description: values.description || null,
        price: values.price ?? 0,
        compare_at_price: values.compare_at_price ?? null,
        image_url: values.image_url?.trim() || null,
        inventory: values.inventory ?? 0,
        product_type: values.product_type?.trim() || null,
        status: values.status || "active",
      };
      const res = await authFetch(`${LOCAL_PRODUCTS_BASE}/${pid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        message.error(json?.detail || json?.message || "保存失败");
        return;
      }
      message.success("已更新");
      setEditorOpen(false);
      loadDetail();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setEditorSubmitting(false);
    }
  };

  const deleteProduct = async () => {
    try {
      const res = await authFetch(`${LOCAL_PRODUCTS_BASE}/${pid}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        message.error(json?.detail || json?.message || "删除失败");
        return;
      }
      message.success("已删除");
      navigate("/app/products");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
    }
  };

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
        {accountType && !isStandalone ? (
          <s-section>
            <div className="dash-shell dash-section-inner" style={{ marginBottom: 12 }}>
              <Alert
                type="warning"
                showIcon
                message="当前为 Shopify 店铺商品，仅支持查看，修改请在 Shopify 后台进行。"
              />
            </div>
          </s-section>
        ) : null}
        {isStandalone ? (
          <s-section>
            <div className="dash-shell dash-section-inner" style={{ marginBottom: 12 }}>
              <Alert
                type="info"
                showIcon
                message="平台本地商品，可编辑或删除。"
                action={
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="small" onClick={openEdit}>
                      编辑
                    </Button>
                    <Popconfirm title="确定删除该商品？" onConfirm={deleteProduct}>
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                }
              />
            </div>
          </s-section>
        ) : null}

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

        {product.body_html && (
          <s-section heading="商品描述">
            <div className="dash-shell dash-section-inner">
              {product._plainDescription ? (
                <div style={{ lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{product.body_html}</div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: product.body_html }} style={{ lineHeight: 1.8 }} />
              )}
            </div>
          </s-section>
        )}

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

      <Modal
        title="编辑商品"
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={submitEdit}
        confirmLoading={editorSubmitting}
        destroyOnHidden
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input maxLength={512} showCount />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="price" label="售价" rules={[{ required: true }]}>
            <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="compare_at_price" label="划线价（可选）">
            <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <ProductImageUrlField />
          <Form.Item name="inventory" label="库存">
            <InputNumber min={0} step={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="product_type" label="商品类型">
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
