import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Modal, Input, message, Spin, Empty, Segmented } from "antd";
import {
  authFetch,
  clearAuthTokens,
  parseTokenResponse,
  saveAuthTokens,
} from "../utils/auth-api";

/** 与网关一致：统一 `/api/v1/*`；开发由 Vite 原样反代到上游 */
const AUTH_API_BASE = "/api/v1/auth";
const MERCHANT_API_BASE = "/api/v1/merchant";

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

export default function Index() {
  const navigate = useNavigate();

  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [priceProducts, setPriceProducts] = useState([]);
  const [priceSelected, setPriceSelected] = useState([]);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceSubmitting, setPriceSubmitting] = useState(false);
  const [priceResult, setPriceResult] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authView, setAuthView] = useState("login");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    password: "",
    shopify_domain: "",
  });
  /** 注册方式：shopify = OAuth 授权；local = 平台自注册（无店铺域名） */
  const [registerMode, setRegisterMode] = useState("shopify");

  /** 当前登录用户信息 */
  const [currentUser, setCurrentUser] = useState(null);

  /** 检查是否已登录（加载时向后端探测会话） */
  useEffect(() => {
    checkLoginStatus();
  }, []);

  /** 验证 token 是否有效，获取用户信息 */
  const checkLoginStatus = async () => {
    try {
      const res = await authFetch(`${MERCHANT_API_BASE}/info`);
      if (res.ok) {
        const json = await res.json();
        const userData = json?.data || json;
        setCurrentUser(userData);
      } else if (res.status === 403) {
        message.error("账号已被禁用，请联系管理员");
        clearAuthTokens();
      } else if (res.status === 401) {
        clearAuthTokens();
      }
      // 5xx / 网络策略错误等：不清 token，避免刚登录就被误删
    } catch (e) {
      if (e instanceof Error && e.message === "AUTH_EXPIRED") {
        clearAuthTokens();
      }
    }
  };

  const handleHotspotView = () => {
    if (!currentUser) {
      message.warning("请先登录后再查看热点");
      openAuthLogin();
      return;
    }
    navigate("/app/hotspot");
  };
  const handleBrandEdit = () => {
    if (!currentUser) {
      message.warning("请先登录后再编辑品牌信息");
      openAuthLogin();
      return;
    }
    navigate("/app/brand-edit");
  };
  const handleDynamicPrice = () => {
    if (!currentUser) {
      message.warning("请先登录后再使用动态调价");
      openAuthLogin();
      return;
    }
    setPriceResult(null);
    setPriceSelected([]);
    loadPriceProducts();
    setPriceModalOpen(true);
  };
  const handleProductsView = () => {
    if (!currentUser) {
      message.warning("请先登录后再查看商品");
      openAuthLogin();
      return;
    }
    navigate("/app/products");
  };
  const handleProductSelect = () => {
    if (!currentUser) {
      message.warning("请先登录后再使用选品系统");
      openAuthLogin();
      return;
    }
    navigate("/app/product-select");
  };
  const handleVideoChat = () => navigate("/app/video-chat");

  const loadPriceProducts = async () => {
    setPriceLoading(true);
    try {
      const res = await authFetch(`${MERCHANT_API_BASE.replace("/merchant", "/products")}?limit=20`);
      if (res.ok) {
        const json = await res.json();
        setPriceProducts(parseProductListResponse(json));
      }
    } catch {
      // ignore
    } finally {
      setPriceLoading(false);
    }
  };

  const handlePriceSubmit = async () => {
    if (priceSelected.length === 0) {
      message.warning("请至少选择一个商品");
      return;
    }
    if (priceSelected.length > 5) {
      message.warning("最多只能选择 5 个商品");
      return;
    }
    setPriceSubmitting(true);
    setPriceResult(null);
    try {
      const res = await authFetch(`${MERCHANT_API_BASE.replace("/merchant", "/pricing-agent")}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product_ids: priceSelected }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.data?.message || json?.message || "调价分析失败";
        message.error(detail);
        return;
      }
      setPriceResult(json?.data || json);
      message.success("调价分析完成");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setPriceSubmitting(false);
    }
  };

  const openAuthLogin = () => {
    setAuthView("login");
    setAuthModalOpen(true);
  };

  /** 登出 */
  const handleLogout = () => {
    clearAuthTokens();
    setCurrentUser(null);
    message.success("已退出登录");
  };

  const submitLogin = async () => {
    if (!loginForm.username.trim() || !loginForm.password) {
      message.warning("请填写用户名和密码");
      return;
    }
    setAuthSubmitting(true);
    try {
      const body = new URLSearchParams();
      body.set("username", loginForm.username.trim());
      body.set("password", loginForm.password);
      const res = await fetch(`${AUTH_API_BASE}/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail =
          data?.data?.message ||
          data?.message ||
          data?.detail ||
          "登录失败";
        message.error(detail);
        return;
      }

      const { accessToken, refreshToken } = parseTokenResponse(data);
      if (accessToken || refreshToken) {
        saveAuthTokens({ accessToken, refreshToken });
      }

      try {
        const infoRes = await authFetch(`${MERCHANT_API_BASE}/info`);
        if (infoRes.ok) {
          const infoJson = await infoRes.json().catch(() => ({}));
          setCurrentUser(infoJson?.data || infoJson);
          message.success("登录成功");
          setAuthModalOpen(false);
          setLoginForm({ username: "", password: "" });
          return;
        }
      } catch (e) {
        if (e instanceof Error && e.message === "AUTH_EXPIRED") {
          clearAuthTokens();
        }
      }

      if (accessToken || refreshToken) {
        message.success("登录成功");
        setAuthModalOpen(false);
        setLoginForm({ username: "", password: "" });
      } else {
        message.error("登录成功但未拿到会话，请检查接口是否返回 token 或 Set-Cookie");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const submitRegisterShopify = async () => {
    const { name, email, password, shopify_domain } = registerForm;
    if (!name.trim() || !email.trim() || !password || !shopify_domain.trim()) {
      message.warning("请填写名称、邮箱、密码与 Shopify 店铺域名");
      return;
    }
    setAuthSubmitting(true);
    try {
      const res = await fetch(`${AUTH_API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          shopify_domain: shopify_domain.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail =
          json?.data?.message ||
          json?.message ||
          json?.detail ||
          "注册失败";
        message.error(detail);
        return;
      }
      if (json.code !== 0 && json.code !== undefined && json.code !== 200) {
        message.error(json.message || json.data?.message || "注册失败");
        return;
      }
      const authUrl = json.data?.auth_url;
      if (authUrl) {
        message.loading("正在跳转 Shopify 授权页面...", 0);
        const opened = window.open(authUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
          message.destroy();
          message.warning("请允许弹出窗口，或手动复制链接授权", 5);
        } else {
          setTimeout(() => {
            message.destroy();
            message.info("授权完成后，请使用相同用户名和密码登录", 8);
          }, 2000);
        }
        setAuthModalOpen(false);
        setAuthView("login");
        setLoginForm({ username: name.trim(), password: password });
        setRegisterForm({
          name: "",
          email: "",
          password: "",
          shopify_domain: "",
        });
      } else {
        message.error("未返回授权链接");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setAuthSubmitting(false);
    }
  };

  /** 平台自注册：无 Shopify 域名，成功后直接下发 token */
  const submitRegisterLocal = async () => {
    const { name, email, password } = registerForm;
    if (!name.trim() || !email.trim() || !password) {
      message.warning("请填写商户名称、邮箱与密码");
      return;
    }
    setAuthSubmitting(true);
    try {
      const res = await fetch(`${AUTH_API_BASE}/localRegister`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail =
          json?.data?.message ||
          json?.message ||
          json?.detail ||
          "注册失败";
        message.error(typeof detail === "string" ? detail : "注册失败");
        return;
      }
      if (json.code !== 0 && json.code !== undefined && json.code !== 200) {
        message.error(json.message || json.data?.message || "注册失败");
        return;
      }

      const { accessToken, refreshToken } = parseTokenResponse(json);
      if (accessToken || refreshToken) {
        saveAuthTokens({ accessToken, refreshToken });
      }

      try {
        const infoRes = await authFetch(`${MERCHANT_API_BASE}/info`);
        if (infoRes.ok) {
          const infoJson = await infoRes.json().catch(() => ({}));
          setCurrentUser(infoJson?.data || infoJson);
        }
      } catch (e) {
        if (e instanceof Error && e.message === "AUTH_EXPIRED") {
          clearAuthTokens();
        }
      }

      message.success("注册成功，已自动登录");
      setAuthModalOpen(false);
      setAuthView("login");
      setRegisterForm({
        name: "",
        email: "",
        password: "",
        shopify_domain: "",
      });
      setLoginForm({ username: name.trim(), password: "" });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const submitRegister = () =>
    registerMode === "local" ? submitRegisterLocal() : submitRegisterShopify();

  return (
    <>
      <div className="dash-shell dash-home">
        <header className="dash-home-header">
          <h1 className="dash-home-header__title">首页</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {currentUser ? (
              <>
                <span style={{ color: "#666", fontSize: "14px" }}>
                  欢迎，{currentUser.name || currentUser.email || "商户"}
                </span>
                <Button onClick={handleLogout} size="small">
                  退出
                </Button>
              </>
            ) : (
              <Button type="primary" onClick={openAuthLogin}>
                登录
              </Button>
            )}
          </div>
        </header>
        <div className="dash-feature-grid">
          <div className="dash-feature-card dash-accent-orange">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">修改品牌信息与定位</h2>
              <span className="dash-icon-box" aria-hidden>
                📋
              </span>
            </div>
            <p className="dash-feature-card__desc">
              编辑品牌名称、定位描述、品牌调性等核心信息
            </p>
            <Button type="primary" onClick={handleBrandEdit}>
              进入编辑
            </Button>
          </div>

          <div className="dash-feature-card dash-accent-blue">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">热点内容生成</h2>
              <span className="dash-icon-box" aria-hidden>
                🔥
              </span>
            </div>
            <p className="dash-feature-card__desc">
              查看最新行业热点、流量数据、用户关注趋势，并生成营销内容
            </p>
            <Button type="primary" onClick={handleHotspotView}>
              查看热点
            </Button>
          </div>

          <div className="dash-feature-card dash-accent-teal">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">动态调价</h2>
              <span className="dash-icon-box" aria-hidden>
                📈
              </span>
            </div>
            <p className="dash-feature-card__desc">
              根据市场波动与竞争态势，智能调整商品定价策略
            </p>
            <Button type="primary" onClick={handleDynamicPrice}>
              开始调价
            </Button>
          </div>

          <div className="dash-feature-card dash-accent-blue">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">商品管理</h2>
              <span className="dash-icon-box" aria-hidden>
                🛍️
              </span>
            </div>
            <p className="dash-feature-card__desc">
              查看商品列表、检查状态，并跳转到商品详情
            </p>
            <Button type="primary" onClick={handleProductsView}>
              查看商品
            </Button>
          </div>

          <div className="dash-feature-card dash-accent-violet">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">视频生成</h2>
              <span className="dash-icon-box" aria-hidden>
                🎬
              </span>
            </div>
            <p className="dash-feature-card__desc">
              对话式描述需求，生成营销短视频（侧栏任务与历史、底部工具栏）
            </p>
            <Button type="primary" onClick={handleVideoChat}>
              进入视频生成
            </Button>
          </div>

          <div className="dash-feature-card dash-accent-teal">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">选品系统</h2>
              <span className="dash-icon-box" aria-hidden>
                🔎
              </span>
            </div>
            <p className="dash-feature-card__desc">
              监控社媒红人内容，识别潜在爆品，并通过供应链搜索验证可采购性
            </p>
            <Button type="primary" onClick={handleProductSelect}>
              进入选品系统
            </Button>
          </div>
        </div>
      </div>

      {/* 登录 / 注册：login 表单；register → Shopify OAuth；localRegister → 平台自注册 JSON） */}
      <Modal
        open={authModalOpen}
        onCancel={() => {
          setAuthModalOpen(false);
          setAuthView("login");
        }}
        title={authView === "login" ? "登录" : "注册"}
        footer={null}
        destroyOnHidden
      >
        {authView === "login" ? (
          <div className="ant-form-stack">
            <div className="ant-form-row">
              <label className="ant-form-label" htmlFor="auth-username">
                用户名 <span className="ant-form-required">*</span>
              </label>
              <Input
                id="auth-username"
                autoComplete="username"
                value={loginForm.username}
                onChange={(e) =>
                  setLoginForm((f) => ({ ...f, username: e.target.value }))
                }
                placeholder="与后台商户名称（name）一致"
              />
            </div>
            <div className="ant-form-row">
              <label className="ant-form-label" htmlFor="auth-password">
                密码 <span className="ant-form-required">*</span>
              </label>
              <Input.Password
                id="auth-password"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(e) =>
                  setLoginForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="请输入密码"
              />
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                marginTop: "1rem",
              }}
            >
              <Button
                type="primary"
                loading={authSubmitting}
                onClick={submitLogin}
              >
                登录
              </Button>
              <Button
                type="link"
                onClick={() => setAuthView("register")}
                style={{ paddingLeft: 0 }}
              >
                立即注册
              </Button>
            </div>
            <div style={{ marginTop: "12px", padding: "8px", background: "#f5f5f5", borderRadius: "4px", fontSize: "12px" }}>
              <strong>测试账号：</strong>如果你已完成注册并授权，可以直接登录。<br/>
              <span style={{ color: "#888" }}>提示：用户名是你注册时填写的「商户名称」，不是邮箱。</span>
            </div>
          </div>
        ) : (
          <div className="ant-form-stack">
            <div className="ant-form-row" style={{ marginBottom: 4 }}>
              <Segmented
                block
                value={registerMode}
                onChange={(v) => setRegisterMode(v)}
                options={[
                  { label: "Shopify 店铺注册", value: "shopify" },
                  { label: "平台注册（无店铺）", value: "local" },
                ]}
              />
            </div>
            <div className="ant-form-row">
              <label className="ant-form-label" htmlFor="reg-name">
                商户名称 <span className="ant-form-required">*</span>
              </label>
              <Input
                id="reg-name"
                value={registerForm.name}
                onChange={(e) =>
                  setRegisterForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="注册后请用此名称登录"
              />
            </div>
            <div className="ant-form-row">
              <label className="ant-form-label" htmlFor="reg-email">
                邮箱 <span className="ant-form-required">*</span>
              </label>
              <Input
                id="reg-email"
                type="email"
                autoComplete="email"
                value={registerForm.email}
                onChange={(e) =>
                  setRegisterForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="name@example.com"
              />
            </div>
            <div className="ant-form-row">
              <label className="ant-form-label" htmlFor="reg-password">
                密码 <span className="ant-form-required">*</span>
              </label>
              <Input.Password
                id="reg-password"
                autoComplete="new-password"
                value={registerForm.password}
                onChange={(e) =>
                  setRegisterForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="设置登录密码"
              />
            </div>
            {registerMode === "shopify" ? (
              <>
                <div className="ant-form-row">
                  <label className="ant-form-label" htmlFor="reg-shop">
                    Shopify 店铺域名 <span className="ant-form-required">*</span>
                  </label>
                  <Input
                    id="reg-shop"
                    value={registerForm.shopify_domain}
                    onChange={(e) =>
                      setRegisterForm((f) => ({
                        ...f,
                        shopify_domain: e.target.value,
                      }))
                    }
                    placeholder="如 your-store.myshopify.com"
                  />
                </div>
                <div style={{ marginTop: "12px", padding: "8px", background: "#fff7e6", borderRadius: "4px", fontSize: "12px", color: "#ad6800" }}>
                  <strong>注册流程说明：</strong><br/>
                  1. 填写信息后点击「注册并获取授权链接」<br/>
                  2. 在弹出的 Shopify 页面完成授权<br/>
                  3. 授权完成后返回此页面，使用「商户名称」和密码登录
                </div>
              </>
            ) : (
              <div style={{ marginTop: "12px", padding: "8px", background: "#f0f5ff", borderRadius: "4px", fontSize: "12px", color: "#2f54eb" }}>
                <strong>说明：</strong>无需绑定 Shopify，注册成功后将直接登录；商品等功能使用平台内维护的数据。
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                marginTop: "1rem",
              }}
            >
              <Button
                type="primary"
                loading={authSubmitting}
                onClick={submitRegister}
              >
                {registerMode === "local" ? "注册并登录" : "注册并获取授权链接"}
              </Button>
              <Button
                type="link"
                onClick={() => setAuthView("login")}
                style={{ paddingLeft: 0 }}
              >
                已有账号？去登录
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 动态调价弹窗 */}
      <Modal
        open={priceModalOpen}
        onCancel={() => setPriceModalOpen(false)}
        title="动态调价"
        width={700}
        footer={
          !priceResult ? (
            <Button
              type="primary"
              loading={priceSubmitting}
              onClick={handlePriceSubmit}
              disabled={priceSelected.length === 0}
            >
              开始分析 {priceSelected.length > 0 ? `（已选 ${priceSelected.length} 个）` : ""}
            </Button>
          ) : (
            <Button onClick={() => { setPriceResult(null); setPriceSelected([]); }}>
              重新选择
            </Button>
          )
        }
      >
        {!priceResult ? (
          <div className="ant-form-stack">
            {priceLoading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <Spin />
                <p style={{ marginTop: 12, color: "#666" }}>正在加载商品列表...</p>
              </div>
            ) : priceProducts.length === 0 ? (
              <Empty description="暂无商品数据，请先在 Shopify 中添加商品" />
            ) : (
              <>
                <p style={{ marginBottom: 12, color: "#666", fontSize: 13 }}>
                  选择要分析的的商品（最多 5 个）：
                </p>
                <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #f0f0f0", borderRadius: 8 }}>
                  {priceProducts.map((p) => {
                    const checked = priceSelected.includes(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => {
                          if (checked) {
                            setPriceSelected((s) => s.filter((id) => id !== p.id));
                          } else if (priceSelected.length < 5) {
                            setPriceSelected((s) => [...s, p.id]);
                          } else {
                            message.warning("最多只能选择 5 个商品");
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "10px 14px",
                          cursor: "pointer",
                          borderBottom: "1px solid #f0f0f0",
                          background: checked ? "#f0f5ff" : "transparent",
                          border: "none",
                          width: "100%",
                          textAlign: "left",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          style={{ marginRight: 10 }}
                        />
                        <span style={{ flex: 1, fontWeight: 500 }}>{p.title}</span>
                        {p.variants?.[0]?.price && (
                          <span style={{ color: "#999", marginLeft: 8 }}>
                            ${p.variants[0].price}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="ant-form-stack">
            <div style={{ padding: "12px", background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 8 }}>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 13, margin: 0 }}>
                {JSON.stringify(priceResult, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
