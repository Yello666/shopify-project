import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

import {
  BlockStack,
  Button,
  Card,
  Text,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  // 模拟功能按钮点击事件（后续可对接实际接口）
  const handleBrandEdit = () => {
    alert("进入品牌信息修改模块");
    // 实际开发：跳转到品牌修改子页面 /app/brand-settings
  };

  const handleHotspotView = () => {
    alert("查看最新热点趋势");
    // 实际开发：跳转到热点查看子页面 /app/hotspot
  };

  const handleMatchCalculate = () => {
    alert("计算热点与品牌调性匹配度");
    // 实际开发：调用匹配计算接口，展示结果
  };

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        {/* 替换默认标题为你的控制面板标题 */}
        <Text as="h1" variant="headingXl" className={styles.heading}>
          shopify商家控制面板
        </Text>
        <Text variant="bodyMd" className={styles.text}>
          管理品牌信息、查看热点数据、计算热点与品牌调性匹配度
        </Text>

        {/* 保留登录表单（仅未登录时显示） */}
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}

        {/* 核心：三个功能板块（Polaris v13：LegacyCard + BlockStack） */}
        <div className={styles.dashboardLayout}>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  修改品牌信息与定位
                </Text>
                <Text>编辑品牌名称、定位描述、品牌调性等核心信息</Text>
                <Button
                  variant="primary"
                  onClick={handleBrandEdit}
                  className={styles.dashboardButton}
                >
                  进入编辑
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  热点查看
                </Text>
                <Text>查看最新行业热点、流量数据、用户关注趋势</Text>
                <Button
                  variant="secondary"
                  onClick={handleHotspotView}
                  className={styles.dashboardButton}
                >
                  查看热点
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  热点与品牌调性匹配计算
                </Text>
                <Text>自动计算热点与品牌调性的匹配度，生成推荐方案</Text>
                <Button
                  variant="tertiary"
                  onClick={handleMatchCalculate}
                  className={styles.dashboardButton}
                >
                  开始计算
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </div>
      </div>
    </div>
  );
}
