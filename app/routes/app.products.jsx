import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message,
} from "antd";
import { authFetch } from "../utils/auth-api";
import { ProductImageUrlField } from "../components/ProductImageUrlField";
import {
  createProductSizeCmGroupRule,
  formatProductSizeDescriptionCm,
  parseProductSizeDescriptionCm,
} from "../utils/productDimensionsCm";

const MERCHANT_INFO_URL = "/api/v1/merchant/info";
const PRODUCTS_API_BASE = "/api/v1/products";
const LOCAL_PRODUCTS_BASE = "/api/v1/local-products";

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
  const id = raw.id ?? raw.product_id;
  const title = raw.title ?? raw.name ?? "";
  const fallbackPrice =
    raw.variants?.[0]?.price ??
    (raw.price != null ? String(raw.price) : undefined);
  const variants = Array.isArray(raw.variants)
    ? raw.variants
    : fallbackPrice
    ? [{ id: `${id || "product"}-default`, price: String(fallbackPrice) }]
    : [];

  return {
    ...raw,
    id,
    title,
    variants,
    vendor: raw.vendor ?? "",
    product_type: raw.product_type ?? "",
    status: raw.status ?? "",
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

const STATUS_OPTIONS = [
  { value: "active", label: "上架 active" },
  { value: "draft", label: "草稿 draft" },
  { value: "archived", label: "归档 archived" },
];

const SIZE_CM_FORM_NAMES = ["size_length_cm", "size_width_cm", "size_height_cm"];
const SIZE_CM_GROUP_RULE = createProductSizeCmGroupRule();

export default function ProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");

  /** 商户类型：standalone 可维护本地商品表；shopify 仅只读浏览 */
  const [accountType, setAccountType] = useState(null);
  const [merchantLoading, setMerchantLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editorSubmitting, setEditorSubmitting] = useState(false);
  const [form] = Form.useForm();

  const isStandalone = accountType === "standalone";

  const loadMerchant = useCallback(async () => {
    setMerchantLoading(true);
    try {
      const res = await authFetch(MERCHANT_INFO_URL);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccountType("shopify");
        return;
      }
      const data = json?.data ?? json;
      setAccountType(data?.account_type || "shopify");
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        setAccountType(null);
      } else {
        setAccountType("shopify");
      }
    } finally {
      setMerchantLoading(false);
    }
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await authFetch(`${PRODUCTS_API_BASE}?limit=50`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.data?.message || json?.message || `获取失败: ${res.status}`;
        throw new Error(detail);
      }
      setProducts(parseProductListResponse(json));
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请返回首页重新登录");
        setError("登录已过期，请返回首页重新登录");
      } else {
        const detail = e instanceof Error ? e.message : "网络错误";
        setError(detail);
        setProducts([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMerchant();
  }, [loadMerchant]);

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      status: "active",
      inventory: 0,
      price: 0,
      size_length_cm: undefined,
      size_width_cm: undefined,
      size_height_cm: undefined,
    });
    setEditorOpen(true);
  };

  const openEdit = async (id) => {
    setEditingId(id);
    setEditorOpen(true);
    form.resetFields();
    try {
      const res = await authFetch(`${LOCAL_PRODUCTS_BASE}/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        message.error(json?.message || json?.detail || "加载商品失败");
        setEditorOpen(false);
        return;
      }
      const row = json?.data ?? json;
      const dims = parseProductSizeDescriptionCm(row.size_description);
      form.setFieldsValue({
        title: row.title,
        description: row.description ?? "",
        size_length_cm: dims.length_cm,
        size_width_cm: dims.width_cm,
        size_height_cm: dims.height_cm,
        price: row.price != null ? Number(row.price) : 0,
        compare_at_price: row.compare_at_price != null ? Number(row.compare_at_price) : undefined,
        image_url: row.image_url ?? "",
        inventory: row.inventory ?? 0,
        product_type: row.product_type ?? "",
        status: row.status ?? "active",
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
      setEditorOpen(false);
    }
  };

  const submitEditor = async () => {
    try {
      const values = await form.validateFields();
      setEditorSubmitting(true);
      const size_description = formatProductSizeDescriptionCm(
        values.size_length_cm,
        values.size_width_cm,
        values.size_height_cm,
      );
      const payload = {
        title: values.title?.trim(),
        description: values.description || null,
        size_description,
        price: values.price ?? 0,
        compare_at_price: values.compare_at_price ?? null,
        image_url: values.image_url?.trim() || null,
        inventory: values.inventory ?? 0,
        product_type: values.product_type?.trim() || null,
        status: values.status || "active",
      };

      const url = editingId == null ? LOCAL_PRODUCTS_BASE : `${LOCAL_PRODUCTS_BASE}/${editingId}`;
      const method = editingId == null ? "POST" : "PUT";
      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || json?.data?.message || "保存失败";
        message.error(typeof detail === "string" ? detail : "保存失败");
        return;
      }
      if (json.code !== 0 && json.code !== undefined && json.code !== 200) {
        message.error(json.message || "保存失败");
        return;
      }
      message.success(editingId == null ? "已创建" : "已更新");
      setEditorOpen(false);
      loadProducts();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setEditorSubmitting(false);
    }
  };

  const deleteProduct = async (id) => {
    try {
      const res = await authFetch(`${LOCAL_PRODUCTS_BASE}/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        message.error(json?.detail || json?.message || "删除失败");
        return;
      }
      message.success("已删除");
      loadProducts();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
    }
  };

  const filteredProducts = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return products;
    return products.filter((product) => {
      const title = String(product?.title || "").toLowerCase();
      const vendor = String(product?.vendor || "").toLowerCase();
      const type = String(product?.product_type || "").toLowerCase();
      return title.includes(kw) || vendor.includes(kw) || type.includes(kw);
    });
  }, [products, keyword]);

  const columns = [
    {
      title: "商品名称",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.title || "—"}</div>
          <div style={{ color: "#999", fontSize: 12 }}>{record.vendor || "未知供应商"}</div>
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "product_type",
      key: "product_type",
      width: 160,
      render: (value) => value || "—",
    },
    {
      title: "价格",
      key: "price",
      width: 120,
      render: (_, record) => {
        const price = record?.variants?.[0]?.price;
        return price ? `$${price}` : "—";
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (status) => {
        if (!status) return "—";
        return (
          <Tag color={status === "active" ? "green" : "default"} style={{ marginRight: 0 }}>
            {status}
          </Tag>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      width: isStandalone ? 220 : 120,
      render: (_, record) => (
        <Space size="small" wrap>
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => navigate(`/app/products/${encodeURIComponent(String(record.id))}`)}
          >
            查看详情
          </Button>
          {isStandalone ? (
            <>
              <Button type="link" style={{ padding: 0 }} onClick={() => openEdit(record.id)}>
                编辑
              </Button>
              <Popconfirm title="确定删除该商品？" onConfirm={() => deleteProduct(record.id)}>
                <Button type="link" danger style={{ padding: 0 }}>
                  删除
                </Button>
              </Popconfirm>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  const pageBusy = merchantLoading || loading;

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate("/app")} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>返回首页</span>
      </button>
      <s-page heading="商品列表">
        <s-section heading="商品管理">
          <div className="dash-shell dash-section-inner">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {!merchantLoading && accountType != null && (
                <Alert
                  type={isStandalone ? "info" : "warning"}
                  showIcon
                  message={
                    isStandalone
                      ? "当前为平台自注册账号，可在此新增、编辑、删除本地商品。"
                      : "当前为 Shopify 店铺账号，商品数据来自店铺，此处仅支持查看。"
                  }
                />
              )}

              <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
                <Input
                  style={{ width: 320, maxWidth: "100%" }}
                  placeholder="按商品名、供应商、类型搜索"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <Space>
                  {isStandalone ? (
                    <Button type="primary" onClick={openCreate}>
                      新建商品
                    </Button>
                  ) : null}
                  <Button onClick={loadProducts}>刷新列表</Button>
                </Space>
              </div>

              {pageBusy ? (
                <div className="dash-page-loading">
                  <Spin size="large" />
                </div>
              ) : error ? (
                <Empty
                  description={`加载失败：${error}`}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Button onClick={() => { loadMerchant(); loadProducts(); }}>重试</Button>
                </Empty>
              ) : (
                <Table
                  rowKey={(record) => String(record.id)}
                  columns={columns}
                  dataSource={filteredProducts}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  scroll={{ x: isStandalone ? 960 : 860 }}
                  locale={{ emptyText: "暂无商品数据" }}
                />
              )}
            </Space>
          </div>
        </s-section>
      </s-page>

      <Modal
        title={editingId == null ? "新建商品" : "编辑商品"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={submitEditor}
        confirmLoading={editorSubmitting}
        destroyOnHidden
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input placeholder="商品标题" maxLength={512} showCount />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="纯文本描述" />
          </Form.Item>
          <Form.Item label="尺寸（长 × 宽 × 高，单位 cm）">
            <Space.Compact block style={{ width: "100%" }}>
              <Form.Item
                name="size_length_cm"
                noStyle
                dependencies={SIZE_CM_FORM_NAMES.filter((n) => n !== "size_length_cm")}
                rules={SIZE_CM_GROUP_RULE}
              >
                <InputNumber min={0} step={0.1} placeholder="长" style={{ width: "33.33%" }} addonAfter="cm" />
              </Form.Item>
              <Form.Item
                name="size_width_cm"
                noStyle
                dependencies={SIZE_CM_FORM_NAMES.filter((n) => n !== "size_width_cm")}
                rules={SIZE_CM_GROUP_RULE}
              >
                <InputNumber min={0} step={0.1} placeholder="宽" style={{ width: "33.33%" }} addonAfter="cm" />
              </Form.Item>
              <Form.Item
                name="size_height_cm"
                noStyle
                dependencies={SIZE_CM_FORM_NAMES.filter((n) => n !== "size_height_cm")}
                rules={SIZE_CM_GROUP_RULE}
              >
                <InputNumber min={0} step={0.1} placeholder="高" style={{ width: "33.34%" }} addonAfter="cm" />
              </Form.Item>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="price" label="售价" rules={[{ required: true, message: "请填写售价" }]}>
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
            <Input placeholder="用于筛选与展示" />
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
