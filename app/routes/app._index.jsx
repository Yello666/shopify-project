import { useState } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Button, Modal, Input } from "antd";

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
        </div>
      </div>

      {/* 品牌信息编辑弹窗 */}
      <Modal
        open={brandModalOpen}
        onCancel={() => setBrandModalOpen(false)}
        title="编辑品牌信息"
        okText="保存"
        cancelText="取消"
        onOk={handleBrandSubmit}
      >
        <div className="ant-form-stack">
          <div className="ant-form-row">
            <label className="ant-form-label" htmlFor="modal-brand-name">
              品牌名称 <span className="ant-form-required">*</span>
            </label>
            <Input
              id="modal-brand-name"
              value={brandForm.brandName}
              onChange={(e) =>
                setBrandForm((f) => ({ ...f, brandName: e.target.value }))
              }
              placeholder="请输入品牌名称"
            />
          </div>
          <div className="ant-form-row">
            <label className="ant-form-label" htmlFor="modal-brand-desc">
              定位描述
            </label>
            <Input.TextArea
              id="modal-brand-desc"
              value={brandForm.description}
              onChange={(e) =>
                setBrandForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="请输入品牌定位描述"
              rows={2}
            />
          </div>
          <div className="ant-form-row">
            <label className="ant-form-label ant-form-label--opt" htmlFor="modal-brand-tone">
              品牌调性（选填）
            </label>
            <Input
              id="modal-brand-tone"
              value={brandForm.tone}
              onChange={(e) =>
                setBrandForm((f) => ({ ...f, tone: e.target.value }))
              }
              placeholder="如：高端奢华、年轻活力、简约自然"
            />
          </div>
        </div>
      </Modal>

      {/* 动态调价弹窗 */}
      <Modal
        open={priceModalOpen}
        onCancel={() => setPriceModalOpen(false)}
        title="动态调价"
        okText="确认调价"
        cancelText="取消"
        onOk={handlePriceSubmit}
      >
        <div className="ant-form-stack">
          <div className="ant-form-row">
            <label className="ant-form-label ant-form-label--opt" htmlFor="modal-price-note">
              说明（选填）
            </label>
            <Input.TextArea
              id="modal-price-note"
              value="系统将根据市场波动与竞争态势，智能调整商品定价策略。点击「确认调价」后将触发调价逻辑。"
              rows={2}
              readOnly
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
