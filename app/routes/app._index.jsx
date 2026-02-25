import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  const handleBrandEdit = () => {
    alert("进入品牌信息修改模块");
  };
  const handleHotspotView = () => {
    alert("查看最新热点趋势");
  };
  const handleMatchCalculate = () => {
    alert("计算热点与品牌调性匹配度");
  };

  return (
    <s-page heading="小电助手-shopify商家控制面板">
      <s-section heading="修改品牌信息与定位">
        <s-paragraph>编辑品牌名称、定位描述、品牌调性等核心信息</s-paragraph>
        <s-button onClick={handleBrandEdit}>进入编辑</s-button>
      </s-section>

      <s-section heading="热点查看">
        <s-paragraph>查看最新行业热点、流量数据、用户关注趋势</s-paragraph>
        <s-button onClick={handleHotspotView}>
          查看热点
        </s-button>
      </s-section>

      <s-section heading="热点与品牌调性匹配计算">
        <s-paragraph>自动计算热点与品牌调性的匹配度，生成推荐方案</s-paragraph>
        <s-button onClick={handleMatchCalculate}>
          开始计算
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
