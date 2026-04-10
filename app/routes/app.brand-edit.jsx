import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Input, message, Spin, Descriptions, Tag } from "antd";

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

export default function BrandEdit() {
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const [brandForm, setBrandForm] = useState({
    brandName: "",
    description: "",
    tone: "",
  });

  const [savedBrand, setSavedBrand] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      message.warning("请先登录");
      navigate("/app");
      return;
    }
    loadUserInfo(token);
  }, [navigate]);

  const loadUserInfo = async (token) => {
    setLoading(true);
    try {
      const res = await fetch(`${MERCHANT_API_BASE}/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        const userData = json?.data || json;
        setCurrentUser(userData);
        setBrandForm({
          brandName: userData.brand?.name || "",
          description: userData.brand?.core_value || "",
          tone: userData.brand?.tone || "",
        });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!brandForm.brandName.trim()) {
      message.warning("请填写品牌名称");
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      message.warning("请先登录");
      navigate("/app");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${MERCHANT_API_BASE}/brand-info`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: brandForm.brandName.trim(),
          core_value: brandForm.description.trim(),
          mainly_sold_products: currentUser?.brand?.industry || "",
          tone: brandForm.tone.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.data?.message || json?.message || "保存失败";
        message.error(detail);
        return;
      }

      const saved = {
        name: brandForm.brandName.trim(),
        core_value: brandForm.description.trim(),
        tone: brandForm.tone.trim(),
        industry: currentUser?.brand?.industry || "",
      };
      setSavedBrand(saved);
      message.success("品牌信息保存成功");

      // 刷新用户信息
      loadUserInfo(token);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <button className="dash-back-btn" onClick={() => navigate("/app")} type="button" aria-label="返回">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>返回首页</span>
        </button>
        <s-page heading="编辑品牌信息">
          <div className="dash-shell">
            <div className="dash-page-loading">
              <Spin size="large" />
              <p style={{ marginTop: 12, color: "var(--dash-muted)" }}>正在加载...</p>
            </div>
          </div>
        </s-page>
      </>
    );
  }

  return (
    <>
      <button className="dash-back-btn" onClick={() => navigate("/app")} type="button" aria-label="返回">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>返回首页</span>
      </button>
      <s-page heading="编辑品牌信息">
        <s-section heading="品牌信息表单">
          <div className="dash-shell dash-section-inner">
            <div className="brand-edit-form">
              <div className="brand-edit-form__row">
                <label className="brand-edit-form__label" htmlFor="brand-name">
                  品牌名称 <span className="brand-edit-form__required">*</span>
                </label>
                <Input
                  id="brand-name"
                  value={brandForm.brandName}
                  onChange={(e) =>
                    setBrandForm((f) => ({ ...f, brandName: e.target.value }))
                  }
                  placeholder="请输入品牌名称"
                  size="large"
                />
              </div>
              <div className="brand-edit-form__row">
                <label className="brand-edit-form__label" htmlFor="brand-desc">
                  定位描述
                </label>
                <Input.TextArea
                  id="brand-desc"
                  value={brandForm.description}
                  onChange={(e) =>
                    setBrandForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="请输入品牌定位描述"
                  rows={3}
                />
              </div>
              <div className="brand-edit-form__row">
                <label className="brand-edit-form__label" htmlFor="brand-tone">
                  品牌调性
                </label>
                <Input
                  id="brand-tone"
                  value={brandForm.tone}
                  onChange={(e) =>
                    setBrandForm((f) => ({ ...f, tone: e.target.value }))
                  }
                  placeholder="如：高端奢华、年轻活力、简约自然"
                  size="large"
                />
              </div>
              <div className="brand-edit-form__footer">
                <Button
                  type="primary"
                  size="large"
                  loading={submitting}
                  onClick={handleSave}
                >
                  保存
                </Button>
              </div>
            </div>
          </div>
        </s-section>

        {/* 保存后展示确认信息 */}
        {savedBrand && (
          <s-section heading="已保存的品牌信息">
            <div className="dash-shell dash-section-inner">
              <div className="brand-edit-preview">
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="品牌名称">
                    <strong>{savedBrand.name}</strong>
                  </Descriptions.Item>
                  <Descriptions.Item label="定位描述">
                    {savedBrand.core_value || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                  </Descriptions.Item>
                  <Descriptions.Item label="品牌调性">
                    {savedBrand.tone ? (
                      <Tag color="blue">{savedBrand.tone}</Tag>
                    ) : (
                      <span style={{ color: "var(--dash-muted)" }}>未填写</span>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="主要售卖商品">
                    {savedBrand.industry || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                  </Descriptions.Item>
                </Descriptions>
                <div style={{ marginTop: 16, padding: "12px", background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 8 }}>
                  <p style={{ margin: 0, color: "#52c41a" }}>
                    <strong>保存成功</strong>，品牌信息已更新。您可以点击上方表单继续修改，或返回首页。
                  </p>
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
