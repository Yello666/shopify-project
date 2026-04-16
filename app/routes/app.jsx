import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
    // eslint-disable-next-line no-undef
    return { apiKey: process.env.SHOPIFY_API_KEY || "" };
  } catch {
    return { apiKey: "" };
  }
};

const polarisI18n = {
  locale: "zh-CN",
  messages: {},
};

export default function App() {
  useLoaderData();

  return (
    <PolarisAppProvider i18n={polarisI18n}>
      <s-app-nav>
        <s-link href="/app">首页</s-link>
        <s-link href="/app/brand-edit">品牌信息</s-link>
        <s-link href="/app/hotspot">热点内容</s-link>
        <s-link href="/app/products">商品管理</s-link>
        <s-link href="/app/generate">内容生成</s-link>
      </s-app-nav>
      <div className="dash-app-background">
        <Outlet />
      </div>
    </PolarisAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
