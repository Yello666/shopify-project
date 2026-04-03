import { useState } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Text, Button, Modal, TextField } from "@shopify/polaris";

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

  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [brandForm, setBrandForm] = useState({
    brandName: "",
    description: "",
    tone: "",
  });

  const handleBrandEdit = () => setBrandModalOpen(true);
  const handleHotspotView = () => navigate("/app/hotspot");
  const handleDynamicPrice = () => setPriceModalOpen(true);

  const handleBrandSubmit = () => {
    setBrandModalOpen(false);
  };

  const handlePriceSubmit = () => {
    setPriceModalOpen(false);
  };

  return (
    <>
      <div className="dash-shell dash-home">
        <div className="dash-feature-grid">
          <div className="dash-feature-card dash-accent-orange">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">修改品牌信息与定位</h2>
              <span className="dash-icon-box" aria-hidden>
                📋
              </span>
            </div>
            <Text variant="bodyMd">
              编辑品牌名称、定位描述、品牌调性等核心信息
            </Text>
            <div className="dash-styled-primary">
              <Button primary onClick={handleBrandEdit}>
                进入编辑
              </Button>
            </div>
          </div>

          <div className="dash-feature-card dash-accent-blue">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">热点内容生成</h2>
              <span className="dash-icon-box" aria-hidden>
                🔥
              </span>
            </div>
            <Text variant="bodyMd">
              查看最新行业热点、流量数据、用户关注趋势，并生成营销内容
            </Text>
            <div className="dash-styled-primary">
              <Button primary onClick={handleHotspotView}>
                查看热点
              </Button>
            </div>
          </div>

          <div className="dash-feature-card dash-accent-teal">
            <div className="dash-feature-card__head">
              <h2 className="dash-card-title">动态调价</h2>
              <span className="dash-icon-box" aria-hidden>
                📈
              </span>
            </div>
            <Text variant="bodyMd">
              根据市场波动与竞争态势，智能调整商品定价策略
            </Text>
            <div className="dash-styled-primary">
              <Button primary onClick={handleDynamicPrice}>
                开始调价
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 品牌信息编辑弹窗 */}
      <Modal
        open={brandModalOpen}
        onClose={() => setBrandModalOpen(false)}
        title="编辑品牌信息"
        primaryAction={{
          content: "保存",
          onAction: handleBrandSubmit,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setBrandModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <div className="hotspot-form-card hotspot-form-card--modal">
            <div className="hotspot-form-card__fields">
              <div className="hotspot-form-card__row">
                <label className="hotspot-form-card__label" htmlFor="index-brand-name">
                  品牌名称 <span className="hotspot-form-card__required">*</span>
                </label>
                <TextField
                  id="index-brand-name"
                  labelHidden
                  value={brandForm.brandName}
                  onChange={(val) =>
                    setBrandForm((f) => ({ ...f, brandName: val }))
                  }
                  placeholder="请输入品牌名称"
                  autoComplete="organization"
                />
              </div>
              <div className="hotspot-form-card__row">
                <label className="hotspot-form-card__label" htmlFor="index-brand-desc">
                  定位描述
                </label>
                <TextField
                  id="index-brand-desc"
                  labelHidden
                  value={brandForm.description}
                  onChange={(val) =>
                    setBrandForm((f) => ({ ...f, description: val }))
                  }
                  placeholder="请输入品牌定位描述"
                  multiline={2}
                />
              </div>
              <div className="hotspot-form-card__row">
                <label className="hotspot-form-card__label hotspot-form-card__label--opt" htmlFor="index-brand-tone">
                  品牌调性（选填）
                </label>
                <TextField
                  id="index-brand-tone"
                  labelHidden
                  value={brandForm.tone}
                  onChange={(val) =>
                    setBrandForm((f) => ({ ...f, tone: val }))
                  }
                  placeholder="如：高端奢华、年轻活力、简约自然"
                />
              </div>
            </div>
          </div>
        </Modal.Section>
      </Modal>

      {/* 动态调价弹窗 */}
      <Modal
        open={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        title="动态调价"
        primaryAction={{
          content: "确认调价",
          onAction: handlePriceSubmit,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setPriceModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <div className="hotspot-form-card hotspot-form-card--modal">
            <div className="hotspot-form-card__fields">
              <div className="hotspot-form-card__row">
                <label className="hotspot-form-card__label hotspot-form-card__label--opt" htmlFor="index-price-note">
                  说明（选填）
                </label>
                <TextField
                  id="index-price-note"
                  labelHidden
                  placeholder="系统将根据市场波动与竞争态势，智能调整商品定价策略"
                  multiline={2}
                  readOnly
                />
              </div>
            </div>
            <div className="hotspot-form-card__footer">
              <Text tone="subdued" variant="bodySm">
                点击「确认调价」后将触发调价逻辑
              </Text>
            </div>
          </div>
        </Modal.Section>
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
