import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Empty, Input, Space, Spin, Table, Tag, message } from "antd";
import { authFetch } from "../utils/auth-api";

const PRODUCTS_API_BASE = "/api/products";

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

export default function ProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");

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
        message.warning("登录已过期，请重新登录");
        navigate("/app");
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
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      width: 120,
      render: (_, record) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => navigate(`/app/products/${encodeURIComponent(String(record.id))}`)}
        >
          查看详情
        </Button>
      ),
    },
  ];

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
              <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
                <Input
                  style={{ width: 320, maxWidth: "100%" }}
                  placeholder="按商品名、供应商、类型搜索"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <Button onClick={loadProducts}>刷新列表</Button>
              </div>

              {loading ? (
                <div className="dash-page-loading">
                  <Spin size="large" />
                </div>
              ) : error ? (
                <Empty
                  description={`加载失败：${error}`}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Button onClick={loadProducts}>重试</Button>
                </Empty>
              ) : (
                <Table
                  rowKey={(record) => String(record.id)}
                  columns={columns}
                  dataSource={filteredProducts}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  scroll={{ x: 860 }}
                  locale={{ emptyText: "暂无商品数据" }}
                />
              )}
            </Space>
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
