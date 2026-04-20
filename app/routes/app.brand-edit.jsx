import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Input, message, Spin, Descriptions, Tag } from "antd";
import { authFetch } from "../utils/auth-api";

const MERCHANT_API_BASE = "/api/merchant";

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
  const hasShownBrandTipRef = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const [brandForm, setBrandForm] = useState({
    brandName: "",
    description: "",
    tone: "",
    mainlySoldProducts: "",
    audienceStr: "",
  });

  const [savedBrand, setSavedBrand] = useState(null);

  const loadUserInfo = useCallback(async () => {
    try {
      const res = await authFetch(`${MERCHANT_API_BASE}/info`);
      if (res.ok) {
        const json = await res.json();
        const userData = json?.data || json;
        setCurrentUser(userData);
        if (userData?.brand) {
          setBrandForm((prev) => ({
            ...prev,
            brandName: userData.brand?.name || prev.brandName,
            description: userData.brand?.core_value || prev.description,
            tone: userData.brand?.tone || prev.tone,
            mainlySoldProducts:
              userData.brand?.mainly_sold_products ||
              userData.brand?.industry ||
              prev.mainlySoldProducts,
            audienceStr: Array.isArray(userData.brand?.audience)
              ? userData.brand.audience.join(",")
              : (typeof userData.brand?.audience === "string"
                  ? userData.brand.audience
                  : prev.audienceStr),
          }));
        }
      }
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录");
        navigate("/app");
      }
    }
  }, [navigate]);

  // 页面打开时获取后端已保存的品牌信息并回填表单
  const loadBrandInfo = useCallback(async () => {
    try {
      const res = await authFetch(`${MERCHANT_API_BASE}/brand-info`);
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      const brandData =
        json?.data?.brand ||
        json?.data ||
        json?.brand ||
        null;
      if (!brandData) return;
      const parsedBrand = {
        brandName: brandData.name || "",
        description: brandData.core_value || "",
        tone: brandData.tone || "",
        mainlySoldProducts:
          brandData.mainly_sold_products || brandData.industry || "",
        audienceStr: Array.isArray(brandData.audience)
          ? brandData.audience.join(",")
          : (typeof brandData.audience === "string" ? brandData.audience : ""),
      };
      setBrandForm((prev) => ({
        ...prev,
        brandName: parsedBrand.brandName || prev.brandName,
        description: parsedBrand.description || prev.description,
        tone: parsedBrand.tone || prev.tone,
        mainlySoldProducts: parsedBrand.mainlySoldProducts || prev.mainlySoldProducts,
        audienceStr: parsedBrand.audienceStr || prev.audienceStr,
      }));
      if (!hasShownBrandTipRef.current) {
        message.info(
          `品牌信息已回填：品牌名称=${parsedBrand.brandName || "未填写"}；品牌介绍=${parsedBrand.description || "未填写"}；品牌风格=${parsedBrand.tone || "未填写"}；主要售卖商品=${parsedBrand.mainlySoldProducts || "未填写"}；目标受众=${parsedBrand.audienceStr || "未填写"}`,
          5
        );
        hasShownBrandTipRef.current = true;
      }
    } catch (e) {
      if (e instanceof Error && ["AUTH_REQUIRED", "AUTH_EXPIRED"].includes(e.message)) {
        message.warning("登录已过期，请重新登录");
        navigate("/app");
      }
    }
  }, [navigate]);

  useEffect(() => {
    const initializePageData = async () => {
      setLoading(true);
      try {
        await loadUserInfo();
        await loadBrandInfo();
      } finally {
        setLoading(false);
      }
    };
    initializePageData();
  }, [loadBrandInfo, loadUserInfo]);

  const parseAudienceInput = (str) => {
    const s = String(str || "").trim();
    if (!s) return [];
    return s
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
  };

  const requestSaveBrand = async (method) => {
    const res = await authFetch(`${MERCHANT_API_BASE}/brand-info`, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: brandForm.brandName.trim(),
        core_value: brandForm.description.trim(),
        mainly_sold_products:
          brandForm.mainlySoldProducts.trim() ||
          currentUser?.brand?.mainly_sold_products ||
          currentUser?.brand?.industry ||
          "",
        tone: brandForm.tone.trim(),
        audience: parseAudienceInput(brandForm.audienceStr),
      }),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  };

  const handleSave = async () => {
    if (!brandForm.brandName.trim()) {
      message.warning("请填写品牌名称");
      return;
    }
    setSubmitting(true);
    try {
      const { res, json } = await requestSaveBrand("POST");
      if (!res.ok) {
        const detail = json?.data?.message || json?.message || "保存失败";
        message.error(detail);
        return;
      }

      const saved = {
        name: brandForm.brandName.trim(),
        core_value: brandForm.description.trim(),
        tone: brandForm.tone.trim(),
        mainly_sold_products: brandForm.mainlySoldProducts.trim(),
        audience: parseAudienceInput(brandForm.audienceStr),
      };
      setSavedBrand(saved);
      message.success("品牌信息保存成功");

      // 刷新用户信息
      loadUserInfo();
      loadBrandInfo();
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
                  品牌介绍
                </label>
                <Input.TextArea
                  id="brand-desc"
                  value={brandForm.description}
                  onChange={(e) =>
                    setBrandForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="请输入品牌介绍"
                  rows={3}
                />
              </div>
              <div className="brand-edit-form__row">
                <label className="brand-edit-form__label" htmlFor="brand-tone">
                  品牌风格
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
              <div className="brand-edit-form__row">
                <label className="brand-edit-form__label" htmlFor="brand-products">
                  主要售卖商品
                </label>
                <Input
                  id="brand-products"
                  value={brandForm.mainlySoldProducts}
                  onChange={(e) =>
                    setBrandForm((f) => ({
                      ...f,
                      mainlySoldProducts: e.target.value,
                    }))
                  }
                  placeholder="如：女装、家居、3C数码"
                  size="large"
                />
              </div>
              <div className="brand-edit-form__row">
                <label className="brand-edit-form__label" htmlFor="brand-audience">
                  目标受众（选填）
                </label>
                <Input
                  id="brand-audience"
                  value={brandForm.audienceStr}
                  onChange={(e) =>
                    setBrandForm((f) => ({ ...f, audienceStr: e.target.value }))
                  }
                  placeholder="多个用英文或中文逗号分隔"
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
                  <Descriptions.Item label="品牌介绍">
                    {savedBrand.core_value || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                  </Descriptions.Item>
                  <Descriptions.Item label="品牌风格">
                    {savedBrand.tone ? (
                      <Tag color="blue">{savedBrand.tone}</Tag>
                    ) : (
                      <span style={{ color: "var(--dash-muted)" }}>未填写</span>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="主要售卖商品">
                    {savedBrand.mainly_sold_products || <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
                  </Descriptions.Item>
                  <Descriptions.Item label="目标受众（选填）">
                    {Array.isArray(savedBrand.audience) && savedBrand.audience.length > 0
                      ? savedBrand.audience.join("、")
                      : <span style={{ color: "var(--dash-muted)" }}>未填写</span>}
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
