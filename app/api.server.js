const BASE_URL = "https://shop-ai.xin";

export async function fetchHotTrends() {
  const response = await fetch(`${BASE_URL}/api/v1/hotspot/hot-trends`);
  if (!response.ok) {
    throw new Error(`获取热点数据失败: ${response.status}`);
  }
  return response.json();
}

export async function fetchMatch(hotspot, brandInfo) {
  const response = await fetch(`${BASE_URL}/api/v1/hotspot/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotspot, ...brandInfo }),
  });
  if (!response.ok) {
    throw new Error(`获取匹配分析失败: ${response.status}`);
  }
  return response.json();
}
