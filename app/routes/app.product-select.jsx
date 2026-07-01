import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  message,
} from "antd";
import { authFetch } from "../utils/auth-api";

const PRODUCT_SELECT_BASE = "/api/v1/product-select";

const POTENTIAL_OPTIONS = [
  { value: "high", label: "high 高潜力" },
  { value: "medium", label: "medium 中潜力" },
  { value: "low", label: "low 低潜力" },
];

const LENS_TYPE_OPTIONS = [
  { value: "products", label: "products 商品" },
  { value: "visual_matches", label: "visual_matches 视觉相似" },
  { value: "exact_matches", label: "exact_matches 精确匹配" },
  { value: "all", label: "all 全部" },
];

function pickResponseData(json) {
  return json?.data && typeof json.data === "object" ? json.data : json;
}

function parseLines(value) {
  return String(value || "")
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMaybe(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function potentialTag(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high") return <Tag color="red">high</Tag>;
  if (normalized === "medium") return <Tag color="orange">medium</Tag>;
  if (normalized === "low") return <Tag color="blue">low</Tag>;
  return <Tag>{value || "unknown"}</Tag>;
}

function getMatchUrl(match) {
  return match?.link || match?.url || "";
}

function getMatchImage(match) {
  return match?.thumbnail || match?.image || match?.thumbnail_url || "";
}

function getObjectPreviewImage(record) {
  const cropImage = record?.crop_image;
  const sourceImage = record?.source_image;
  return cropImage?.oss_url || cropImage?.local_path || sourceImage?.oss_url || sourceImage?.source_url || sourceImage?.local_path || "";
}

function getSourceMonitorName(record) {
  return record?.source_monitor?.display_name || record?.source_monitor?.handle || "";
}

function formatMatchPrice(match) {
  if (match?.price_text) return match.price_text;
  if (match?.price == null) return "—";
  return `${match.currency || ""}${match.price}`;
}

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch {
    // 未登录或网络异常时允许页面降级渲染，接口请求会再处理鉴权。
  }
  return null;
};

export default function ProductSelectPage() {
  const navigate = useNavigate();
  const [monitorForm] = Form.useForm();
  const [monitorListForm] = Form.useForm();
  const [monitorEditForm] = Form.useForm();
  const [summaryForm] = Form.useForm();
  const [supplyForm] = Form.useForm();
  const [objectForm] = Form.useForm();

  const [monitorListLoading, setMonitorListLoading] = useState(false);
  const [monitorUpdating, setMonitorUpdating] = useState(false);
  const [monitorSubmitting, setMonitorSubmitting] = useState(false);
  const [aggregateSubmitting, setAggregateSubmitting] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [supplySubmitting, setSupplySubmitting] = useState(false);
  const [objectLoading, setObjectLoading] = useState(false);
  const [supplyMatchObjectId, setSupplyMatchObjectId] = useState(null);

  const [monitors, setMonitors] = useState({ items: [], returned_count: 0 });
  const [selectedMonitors, setSelectedMonitors] = useState([]);
  const [monitorListError, setMonitorListError] = useState("");
  const [monitorResult, setMonitorResult] = useState(null);
  const [editingMonitor, setEditingMonitor] = useState(null);
  const [monitorEditOpen, setMonitorEditOpen] = useState(false);
  const [aggregateResult, setAggregateResult] = useState(null);
  const [summary, setSummary] = useState({ stats: {}, rows: [], returned_count: 0 });
  const [summaryError, setSummaryError] = useState("");
  const [supplyResult, setSupplyResult] = useState(null);
  const [objects, setObjects] = useState({ items: [], returned_count: 0 });
  const [objectFilters, setObjectFilters] = useState({});
  const [objectError, setObjectError] = useState("");
  const [matches, setMatches] = useState({ items: [], returned_count: 0 });
  const [selectedObject, setSelectedObject] = useState(null);
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [selectedSupplyItem, setSelectedSupplyItem] = useState(null);
  const [supplyMatchModalOpen, setSupplyMatchModalOpen] = useState(false);

  const loadMonitors = useCallback(
    async (values = monitorListForm.getFieldsValue()) => {
      setMonitorListLoading(true);
      setMonitorListError("");
      try {
        const params = new URLSearchParams();
        if (values.platform) params.set("platform", values.platform.trim());
        if (values.is_enabled !== undefined && values.is_enabled !== null) {
          params.set("is_enabled", String(values.is_enabled));
        }
        params.set("limit", String(values.limit || 100));

        const res = await authFetch(`${PRODUCT_SELECT_BASE}/monitors?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = json?.detail || json?.message || `获取失败: ${res.status}`;
          throw new Error(typeof detail === "string" ? detail : "监控账号加载失败");
        }
        const data = pickResponseData(json);
        setMonitors({
          items: Array.isArray(data?.items) ? data.items : [],
          returned_count: Number(data?.returned_count) || 0,
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : "监控账号加载失败";
        setMonitorListError(detail);
        setMonitors({ items: [], returned_count: 0 });
      } finally {
        setMonitorListLoading(false);
      }
    },
    [monitorListForm],
  );

  const loadSummary = useCallback(
    async (values = summaryForm.getFieldsValue()) => {
      setSummaryLoading(true);
      setSummaryError("");
      try {
        const params = new URLSearchParams();
        if (values.platform) params.set("platform", values.platform.trim());
        if (values.account) params.set("account", values.account.trim());
        if (values.potential) params.set("potential", values.potential);
        params.set("limit", String(values.limit || 200));

        const res = await authFetch(`${PRODUCT_SELECT_BASE}/summary?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = json?.detail || json?.message || `获取失败: ${res.status}`;
          throw new Error(typeof detail === "string" ? detail : "选品汇总加载失败");
        }
        const data = pickResponseData(json);
        setSummary({
          stats: data?.stats || {},
          rows: Array.isArray(data?.rows) ? data.rows : [],
          returned_count: Number(data?.returned_count) || 0,
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : "选品汇总加载失败";
        setSummaryError(detail);
        setSummary({ stats: {}, rows: [], returned_count: 0 });
      } finally {
        setSummaryLoading(false);
      }
    },
    [summaryForm],
  );

  const loadObjects = useCallback(
    async (values = objectForm.getFieldsValue()) => {
      setObjectLoading(true);
      setObjectError("");
      try {
        const params = new URLSearchParams();
        if (values.category) params.set("category", values.category.trim());
        params.set("limit", "500");
        params.set("offset", "0");

        const res = await authFetch(`${PRODUCT_SELECT_BASE}/objects?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = json?.detail || json?.message || `获取失败: ${res.status}`;
          throw new Error(typeof detail === "string" ? detail : "商品机会加载失败");
        }
        const data = pickResponseData(json);
        setObjects({
          items: Array.isArray(data?.items) ? data.items : [],
          returned_count: Number(data?.returned_count) || 0,
        });
        setObjectFilters({
          potential: values?.potential,
          source_monitor: values?.source_monitor,
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : "商品机会加载失败";
        setObjectError(detail);
        setObjects({ items: [], returned_count: 0 });
      } finally {
        setObjectLoading(false);
      }
    },
    [objectForm],
  );

  const loadObjectProductMatches = async (record, refresh = false) => {
    if (!record?.id) return;
    setSupplyMatchObjectId(record.id);
    setSelectedObject(record);
    setMatches({ items: [], returned_count: 0 });
    setMatchModalOpen(true);
    try {
      const url = `${PRODUCT_SELECT_BASE}/objects/${record.id}/matches`;
      const res = await authFetch(
        refresh ? `${url}/refresh` : `${url}?${new URLSearchParams({ limit: "3" }).toString()}`,
        refresh
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lens_type: "products",
                limit: 3,
              }),
            }
          : undefined,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || `获取失败: ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : "相似商品失败");
      }
      const data = pickResponseData(json);
      const rawMatches = refresh ? data?.top_matches : data?.items;
      const topMatches = Array.isArray(rawMatches) ? rawMatches.slice(0, 3) : [];
      setMatches({
        items: topMatches,
        returned_count: topMatches.length,
      });
      message.success(refresh ? "相似商品已刷新" : "已加载相似商品");
      if (refresh) loadObjects();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "相似商品失败");
      setMatches({ items: [], returned_count: 0 });
    } finally {
      setSupplyMatchObjectId(null);
    }
  };

  useEffect(() => {
    loadMonitors();
  }, [loadMonitors]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadObjects();
  }, [loadObjects]);

  const runMonitorPool = async () => {
    try {
      const values = await monitorForm.validateFields();
      if (!selectedMonitors.length) {
        message.warning("请先从监控池填入本次监控对象");
        return;
      }
      setMonitorSubmitting(true);
      const payload = {
        monitor_ids: selectedMonitors.map((item) => item.id),
        posts_per_profile: values.posts_per_profile || 3,
        max_images_per_post: values.max_images_per_post || 4,
        force: Boolean(values.force),
      };

      const res = await authFetch(`${PRODUCT_SELECT_BASE}/monitors/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || `执行失败: ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : "IP 监控失败");
      }
      const data = pickResponseData(json);
      setMonitorResult(data);
      if (Array.isArray(data?.unsupported_monitors) && data.unsupported_monitors.length) {
        message.warning(`监控完成，${data.unsupported_monitors.length} 个非 Instagram 对象暂不支持运行`);
      } else {
        message.success("IP 监控完成");
      }
      loadObjects();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e instanceof Error ? e.message : "IP 监控失败");
    } finally {
      setMonitorSubmitting(false);
    }
  };

  const updateMonitor = async (record, patch) => {
    try {
      const res = await authFetch(`${PRODUCT_SELECT_BASE}/monitors/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || `更新失败: ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : "监控账号更新失败");
      }
      message.success("监控账号已更新");
      loadMonitors();
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "监控账号更新失败");
      return false;
    }
  };

  const addMonitorToRun = (record) => {
    if (!record?.is_enabled) {
      message.warning("停用的监控对象不能加入本次任务");
      return;
    }
    setSelectedMonitors((current) => {
      if (current.some((item) => item.id === record.id)) return current;
      return [...current, record];
    });
  };

  const addEnabledMonitorsToRun = () => {
    const enabledMonitors = monitors.items.filter((item) => item.is_enabled);
    if (!enabledMonitors.length) {
      message.warning("暂无启用的监控对象");
      return;
    }
    setSelectedMonitors((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      return [...current, ...enabledMonitors.filter((item) => !existingIds.has(item.id))];
    });
    message.success(`已填入 ${enabledMonitors.length} 个启用监控对象`);
  };

  const removeSelectedMonitor = (monitorId) => {
    setSelectedMonitors((current) => current.filter((item) => item.id !== monitorId));
  };

  const handleObjectFilterChange = (changedValues, allValues) => {
    if (!("potential" in changedValues) && !("source_monitor" in changedValues)) return;
    setObjectFilters({
      potential: allValues.potential,
      source_monitor: allValues.source_monitor,
    });
  };

  const openMonitorEdit = (record) => {
    setEditingMonitor(record);
    monitorEditForm.setFieldsValue({
      display_name: record.display_name,
      score: record.score,
      is_enabled: record.is_enabled,
    });
    setMonitorEditOpen(true);
  };

  const saveMonitorEdit = async () => {
    if (!editingMonitor?.id) return;
    try {
      const values = await monitorEditForm.validateFields();
      setMonitorUpdating(true);
      const ok = await updateMonitor(editingMonitor, {
        display_name: values.display_name?.trim() || null,
        score: values.score,
        is_enabled: values.is_enabled,
      });
      if (!ok) return;
      setSelectedMonitors((current) =>
        current
          .map((item) =>
            item.id === editingMonitor.id
              ? { ...item, display_name: values.display_name?.trim() || null, score: values.score, is_enabled: values.is_enabled }
              : item,
          )
          .filter((item) => item.is_enabled),
      );
      setMonitorEditOpen(false);
      setEditingMonitor(null);
    } catch (e) {
      if (e?.errorFields) return;
    } finally {
      setMonitorUpdating(false);
    }
  };

  const runAggregate = async () => {
    setAggregateSubmitting(true);
    try {
      const res = await authFetch(`${PRODUCT_SELECT_BASE}/aggregate/run`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || `聚合失败: ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : "选品聚合失败");
      }
      const data = pickResponseData(json);
      setAggregateResult(data);
      message.success("选品汇总已生成");
      loadSummary();
      loadObjects();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "选品聚合失败");
    } finally {
      setAggregateSubmitting(false);
    }
  };

  const runSupplyTest = async () => {
    try {
      const values = await supplyForm.validateFields();
      const images = parseLines(values.images);
      if (!images.length) {
        message.warning("请至少填写一张图片路径");
        return;
      }
      setSupplySubmitting(true);
      const res = await authFetch(`${PRODUCT_SELECT_BASE}/supply/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images,
          potential_filter: values.potential_filter || [],
          lens_type: values.lens_type || "products",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || `测试失败: ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : "相似商品测试失败");
      }
      setSupplyResult(pickResponseData(json));
      message.success("相似商品测试完成");
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e instanceof Error ? e.message : "相似商品测试失败");
    } finally {
      setSupplySubmitting(false);
    }
  };

  const statEntries = useMemo(() => {
    const stats = summary?.stats || {};
    return Object.entries(stats).slice(0, 8);
  }, [summary]);

  const supplyItems = useMemo(() => {
    const results = Array.isArray(supplyResult?.results) ? supplyResult.results : [];
    return results.flatMap((result, resultIndex) => {
      const items = Array.isArray(result?.items) ? result.items : [];
      return items.map((item, itemIndex) => ({
        ...item,
        _rowKey: `${result?.source_image || "image"}-${resultIndex}-${itemIndex}`,
        source_image: result?.source_image,
        detected_count: result?.detected_count,
        queried_count: result?.queried_count,
        result_path: result?.result_path,
      }));
    });
  }, [supplyResult]);

  const sourceIpOptions = useMemo(() => {
    const values = new Set();
    for (const item of objects.items) {
      const sourceName = getSourceMonitorName(item);
      if (sourceName) values.add(String(sourceName));
    }
    return Array.from(values)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      .map((value) => ({ value, label: value }));
  }, [objects.items]);

  const displayedObjects = useMemo(() => {
    return objects.items.filter((item) => {
      if (objectFilters.potential && item.ecommerce_potential !== objectFilters.potential) return false;
      if (objectFilters.source_monitor && getSourceMonitorName(item) !== objectFilters.source_monitor) return false;
      return true;
    });
  }, [objectFilters.potential, objectFilters.source_monitor, objects.items]);

  const columns = [
    {
      title: "选品/对象",
      key: "name",
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {record.product_name || record.object_name || record.name || record.label || "未命名选品"}
          </div>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            {formatMaybe(record.category || record.product_type || record.object_type)}
          </div>
        </div>
      ),
    },
    {
      title: "来源",
      key: "source",
      width: 220,
      render: (_, record) => (
        <div>
          <div>{formatMaybe(record.platform)}</div>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            {formatMaybe(record.account || record.username || record.channel)}
          </div>
        </div>
      ),
    },
    {
      title: "潜力",
      dataIndex: "ecommerce_potential",
      key: "potential",
      width: 120,
      render: potentialTag,
    },
    {
      title: "理由/说明",
      key: "reason",
      ellipsis: true,
      render: (_, record) =>
        formatMaybe(record.reason || record.evidence || record.description || record.caption),
    },
    {
      title: "链接",
      key: "link",
      width: 120,
      render: (_, record) => {
        const url = record.post_url || record.source_url || record.url;
        return url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            查看来源
          </a>
        ) : (
          "—"
        );
      },
    },
  ];

  const openSupplyMatches = (record) => {
    setSelectedSupplyItem(record);
    setSupplyMatchModalOpen(true);
  };

  const monitorColumns = [
    {
      title: "账号",
      key: "handle",
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {record.display_name || record.handle || "未命名账号"}
          </div>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            @{record.handle} · {record.platform}
          </div>
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "monitor_type",
      key: "monitor_type",
      width: 120,
      render: (value) => value || "profile",
    },
    {
      title: "评分",
      dataIndex: "score",
      key: "score",
      width: 100,
      render: (value) => (value == null ? "—" : value),
    },
    {
      title: "状态",
      dataIndex: "is_enabled",
      key: "is_enabled",
      width: 110,
      render: (value) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: "上次检查",
      dataIndex: "last_checked_at",
      key: "last_checked_at",
      width: 180,
      render: formatMaybe,
    },
    {
      title: "操作",
      key: "action",
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => openMonitorEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => addMonitorToRun(record)}
          >
            填入监控表单
          </Button>
        </Space>
      ),
    },
  ];

  const objectColumns = [
    {
      title: "图片",
      key: "image",
      width: 104,
      render: (_, record) => {
        const image = getObjectPreviewImage(record);
        return image ? (
          <a href={image} target="_blank" rel="noopener noreferrer">
            <img
              src={image}
              alt={record.category || "商品机会"}
              style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }}
            />
          </a>
        ) : (
          "—"
        );
      },
    },
    {
      title: "商品机会",
      key: "object",
      width: 160,
      render: (_, record) => (
        <div>
          <Space size={6} wrap>
            <span style={{ fontWeight: 600, whiteSpace: "normal", wordBreak: "break-word" }}>
              {record.category || "未分类商品机会"}
            </span>
            {record.is_test ? <Tag>测试</Tag> : null}
          </Space>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            来源 IP：{formatMaybe(record.related_ip)}
          </div>
        </div>
      ),
    },
    {
      title: "来源 IP",
      key: "sourceMonitor",
      width: 160,
      render: (_, record) => (
        <div>
          <div>{formatMaybe(getSourceMonitorName(record))}</div>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            {formatMaybe(record.source_monitor?.platform)}
          </div>
        </div>
      ),
    },
    {
      title: "潜力",
      dataIndex: "ecommerce_potential",
      key: "potential",
      width: 120,
      render: potentialTag,
    },
    {
      title: "说明",
      key: "description",
      width: 220,
      render: (_, record) => (
        <div style={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-word" }}>
          {formatMaybe(record.description || record.reason)}
        </div>
      ),
    },
    {
      title: "属性",
      key: "attributes",
      width: 220,
      render: (_, record) => (
        <div style={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-word" }}>
          {formatMaybe(record.attributes)}
        </div>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 130,
      render: (_, record) => {
        const contentUrl = record.source_content?.url;
        return (
          <Space direction="vertical" size={2}>
            {contentUrl ? (
              <a href={contentUrl} target="_blank" rel="noopener noreferrer">
                查看原帖
              </a>
            ) : (
              <span style={{ color: "var(--dash-muted)" }}>暂无原帖</span>
            )}
            <Button
              type="link"
              style={{ padding: 0 }}
              loading={supplyMatchObjectId === record.id}
              onClick={() => loadObjectProductMatches(record, false)}
            >
              查看相似商品
            </Button>
          </Space>
        );
      },
    },
  ];

  const matchColumns = [
    {
      title: "图片",
      key: "image",
      width: 96,
      render: (_, record) => {
        const image = getMatchImage(record);
        return image ? (
          <a href={image} target="_blank" rel="noopener noreferrer">
            <img
              src={image}
              alt={record.title || "匹配商品"}
              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }}
            />
          </a>
        ) : (
          "—"
        );
      },
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 120,
      render: (value) => value || "—",
    },
    {
      title: "商品",
      key: "title",
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.title || "未命名商品"}</div>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>{formatMaybe(record.store)}</div>
        </div>
      ),
    },
    {
      title: "匹配",
      dataIndex: "match_level",
      key: "match_level",
      width: 120,
      render: (value) => value || "—",
    },
    {
      title: "价格",
      key: "price",
      width: 120,
      render: (_, record) => formatMatchPrice(record),
    },
    {
      title: "评分",
      key: "rating",
      width: 120,
      render: (_, record) =>
        record.rating == null ? "—" : `${record.rating}${record.reviews ? ` / ${record.reviews}评` : ""}`,
    },
    {
      title: "链接",
      key: "url",
      width: 120,
      render: (_, record) => {
        const url = getMatchUrl(record);
        return url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            打开
          </a>
        ) : (
          "—"
        );
      },
    },
  ];

  const supplyItemColumns = [
    {
      title: "对应商品",
      key: "product",
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.category || "未分类商品"}</div>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            来源 IP：{formatMaybe(record.related_ip)}
          </div>
        </div>
      ),
    },
    {
      title: "潜力",
      dataIndex: "ecommerce_potential",
      key: "potential",
      width: 120,
      render: potentialTag,
    },
    {
      title: "图片/裁剪",
      key: "image",
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <span style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            原图：{formatMaybe(record.source_image)}
          </span>
          <span style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            裁剪：{formatMaybe(record.crop_path)}
          </span>
        </Space>
      ),
    },
    {
      title: "搜索图",
      key: "oss",
      width: 110,
      render: (_, record) =>
        record.oss_url ? (
          <a href={record.oss_url} target="_blank" rel="noopener noreferrer">
            打开图片
          </a>
        ) : (
          "—"
        ),
    },
    {
      title: "匹配数",
      key: "matches",
      width: 100,
      render: (_, record) => (Array.isArray(record.top_matches) ? record.top_matches.length : 0),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, record) => (record.error ? <Tag color="red">{record.error}</Tag> : <Tag color="green">完成</Tag>),
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      render: (_, record) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => openSupplyMatches(record)}>
          查看匹配
        </Button>
      ),
    },
  ];

  const supplyMatchColumns = [
    {
      title: "图片",
      key: "image",
      width: 96,
      render: (_, record) => {
        const image = getMatchImage(record);
        return image ? (
          <a href={image} target="_blank" rel="noopener noreferrer">
            <img
              src={image}
              alt={record.title || "匹配商品"}
              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }}
            />
          </a>
        ) : (
          "—"
        );
      },
    },
    {
      title: "匹配商品",
      key: "title",
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.title || "未命名商品"}</div>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>{formatMaybe(record.source)}</div>
        </div>
      ),
    },
    {
      title: "价格",
      key: "price",
      width: 130,
      render: (_, record) => formatMatchPrice(record),
    },
    {
      title: "评分",
      key: "rating",
      width: 140,
      render: (_, record) =>
        record.rating == null ? "—" : `${record.rating}${record.reviews ? ` / ${record.reviews}评` : ""}`,
    },
    {
      title: "排序分",
      dataIndex: "rank_score",
      key: "rank_score",
      width: 100,
      render: (value) => (value == null ? "—" : value),
    },
    {
      title: "库存",
      dataIndex: "in_stock",
      key: "in_stock",
      width: 100,
      render: (value) => (value == null ? "—" : value ? <Tag color="green">有货</Tag> : <Tag>未知/无货</Tag>),
    },
    {
      title: "链接",
      key: "link",
      width: 110,
      render: (_, record) => {
        const url = getMatchUrl(record);
        return url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            打开链接
          </a>
        ) : (
          "—"
        );
      },
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
      <s-page heading="选品系统">
        <s-section heading="社媒趋势选品工作台">
          <div className="dash-shell dash-section-inner">
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Card title="1. IP 监控池">
                <Form
                  form={monitorListForm}
                  layout="inline"
                  initialValues={{ platform: "instagram", is_enabled: null, limit: 100 }}
                  onFinish={loadMonitors}
                  style={{ rowGap: 12, marginBottom: 16 }}
                >
                  <Form.Item label="平台" name="platform">
                    <Input placeholder="instagram" style={{ width: 140 }} allowClear />
                  </Form.Item>
                  <Form.Item label="状态" name="is_enabled">
                    <Select
                      allowClear
                      placeholder="全部"
                      style={{ width: 120 }}
                      options={[
                        { value: true, label: "启用" },
                        { value: false, label: "停用" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="数量" name="limit">
                    <InputNumber min={1} max={500} />
                  </Form.Item>
                  <Form.Item>
                    <Space>
                      <Button htmlType="submit" loading={monitorListLoading}>
                        查询
                      </Button>
                      <Button onClick={addEnabledMonitorsToRun}>
                        填入全部启用对象
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>

                {monitorListLoading ? (
                  <div className="dash-page-loading">
                    <Spin size="large" />
                  </div>
                ) : monitorListError ? (
                  <Empty description={monitorListError} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Table
                    rowKey={(record) => record.id}
                    columns={monitorColumns}
                    dataSource={monitors.items}
                    pagination={{ defaultPageSize: 6, showSizeChanger: true, pageSizeOptions: [6, 10, 20, 50] }}
                    scroll={{ x: 900 }}
                  />
                )}
              </Card>

              <Card title="2. IP 监控">
                <Form
                  form={monitorForm}
                  layout="vertical"
                  initialValues={{ posts_per_profile: 3, max_images_per_post: 4, force: false }}
                >
                  <Form.Item label="本次监控对象" extra="点击监控池列表里的「填入监控表单」加入；点击标签上的 x 仅从本次任务移除。">
                    <div
                      style={{
                        minHeight: 76,
                        border: "1px solid #d9d9d9",
                        borderRadius: 8,
                        padding: 12,
                        background: "#fff",
                      }}
                    >
                      {selectedMonitors.length ? (
                        <Space size={[8, 8]} wrap>
                          {selectedMonitors.map((item) => (
                            <Tag key={item.id} closable onClose={() => removeSelectedMonitor(item.id)}>
                              {item.display_name || item.handle}
                              <span style={{ color: "var(--dash-muted)", marginLeft: 6 }}>
                                {item.platform} · {item.score ?? "—"}分
                              </span>
                            </Tag>
                          ))}
                        </Space>
                      ) : (
                        <span style={{ color: "var(--dash-muted)" }}>暂无本次监控对象</span>
                      )}
                    </div>
                  </Form.Item>
                  <Space size="middle" wrap>
                    <Form.Item label="每个账号抓取帖子数" name="posts_per_profile">
                      <InputNumber min={1} max={20} />
                    </Form.Item>
                    <Form.Item label="每帖最多图片数" name="max_images_per_post">
                      <InputNumber min={1} max={10} />
                    </Form.Item>
                    <Form.Item label="强制重新识别" name="force">
                      <Select
                        style={{ width: 140 }}
                        options={[
                          { value: false, label: "否" },
                          { value: true, label: "是" },
                        ]}
                      />
                    </Form.Item>
                  </Space>
                  <div>
                    <Button type="primary" onClick={runMonitorPool} loading={monitorSubmitting}>
                      开始监控
                    </Button>
                  </div>
                </Form>
                {monitorResult ? (
                  <div style={{ marginTop: 16 }}>
                    <Space wrap size="large">
                      <Statistic title="抓取帖子" value={monitorResult.fetched_posts || 0} />
                      <Statistic title="成功处理" value={monitorResult.processed_posts || 0} />
                      <Statistic title="跳过" value={monitorResult.skipped_posts || 0} />
                      <Statistic title="失败" value={monitorResult.failed_posts || 0} />
                      <Statistic title="识别对象" value={monitorResult.object_total || 0} />
                      <Statistic title="暂不支持" value={monitorResult.unsupported_monitors?.length || 0} />
                    </Space>
                  </div>
                ) : null}
              </Card>

              <Card title="3. 数据库商品机会">
                <Form
                  form={objectForm}
                  layout="inline"
                  initialValues={{}}
                  onValuesChange={handleObjectFilterChange}
                  onFinish={loadObjects}
                  style={{ rowGap: 12, marginBottom: 16 }}
                >
                  <Form.Item label="潜力" name="potential">
                    <Select style={{ width: 160 }} allowClear options={POTENTIAL_OPTIONS} />
                  </Form.Item>
                  <Form.Item label="来源 IP" name="source_monitor">
                    <Select
                      placeholder="选择来源 IP"
                      style={{ width: 180 }}
                      allowClear
                      showSearch
                      options={sourceIpOptions}
                      optionFilterProp="label"
                    />
                  </Form.Item>
                  <Form.Item label="品类" name="category">
                    <Input placeholder="category" style={{ width: 160 }} allowClear />
                  </Form.Item>
                  <Form.Item>
                    <Button htmlType="submit" loading={objectLoading}>
                      查询
                    </Button>
                  </Form.Item>
                </Form>
                {objectLoading ? (
                  <div className="dash-page-loading">
                    <Spin size="large" />
                  </div>
                ) : objectError ? (
                  <Empty description={objectError} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Table
                    rowKey={(record) => record.id}
                    columns={objectColumns}
                    dataSource={displayedObjects}
                    pagination={{ defaultPageSize: 6, showSizeChanger: true, pageSizeOptions: [6, 10, 20, 50] }}
                    scroll={{ x: 1140 }}
                  />
                )}
              </Card>

              <Collapse
                items={[
                  {
                    key: "advanced",
                    label: "高级工具（文件汇总 / 手动相似商品测试）",
                    children: (
                      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                        <Alert
                          type="warning"
                          showIcon
                          message="这里是调试和补数据工具。日常使用优先在「数据库商品机会」列表里查看相似商品。"
                        />
                        <Card
                          title="生成文件汇总"
                          extra={
                            <Button type="primary" onClick={runAggregate} loading={aggregateSubmitting}>
                              生成汇总
                            </Button>
                          }
                        >
                          {aggregateResult ? (
                            <Space direction="vertical" size={4}>
                              <div>summary.json：{formatMaybe(aggregateResult.summary_json)}</div>
                              <div>summary.csv：{formatMaybe(aggregateResult.summary_csv)}</div>
                            </Space>
                          ) : (
                            <span style={{ color: "var(--dash-muted)" }}>
                              聚合识别结果后，下面的文件选品总表会自动刷新。
                            </span>
                          )}
                        </Card>

                        <Card title="文件选品总表">
                          <Form
                            form={summaryForm}
                            layout="inline"
                            initialValues={{ limit: 200 }}
                            onFinish={loadSummary}
                            style={{ rowGap: 12, marginBottom: 16 }}
                          >
                            <Form.Item label="平台" name="platform">
                              <Input placeholder="instagram" style={{ width: 150 }} allowClear />
                            </Form.Item>
                            <Form.Item label="账号" name="account">
                              <Input placeholder="账号名" style={{ width: 150 }} allowClear />
                            </Form.Item>
                            <Form.Item label="潜力" name="potential">
                              <Select style={{ width: 160 }} allowClear options={POTENTIAL_OPTIONS} />
                            </Form.Item>
                            <Form.Item label="数量" name="limit">
                              <InputNumber min={1} max={2000} />
                            </Form.Item>
                            <Form.Item>
                              <Button htmlType="submit" loading={summaryLoading}>
                                查询
                              </Button>
                            </Form.Item>
                          </Form>

                          {statEntries.length ? (
                            <Space wrap size="large" style={{ marginBottom: 16 }}>
                              {statEntries.map(([key, value]) => (
                                <Statistic key={key} title={key} value={formatMaybe(value)} />
                              ))}
                            </Space>
                          ) : null}

                          {summaryLoading ? (
                            <div className="dash-page-loading">
                              <Spin size="large" />
                            </div>
                          ) : summaryError ? (
                            <Empty description={summaryError} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          ) : (
                            <Table
                              rowKey={(record, index) =>
                                record.id || record.product_id || record.post_id || `${record.account || "row"}-${index}`
                              }
                              columns={columns}
                              dataSource={summary.rows}
                              pagination={{ pageSize: 10, showSizeChanger: true }}
                              scroll={{ x: 900 }}
                            />
                          )}
                        </Card>

                        <Card title="手动相似商品测试">
                          <Form
                            form={supplyForm}
                            layout="vertical"
                            initialValues={{ potential_filter: ["high"], lens_type: "products" }}
                          >
                            <Form.Item
                              label="图片路径"
                              name="images"
                              rules={[{ required: true, message: "请填写图片路径" }]}
                              extra="仅用于调试单张图片，不写入数据库；多张图片可换行或用逗号分隔。"
                            >
                              <Input.TextArea rows={3} placeholder="例如：data/productSelect/instagram/user/post/image.jpg" />
                            </Form.Item>
                            <Space size="middle" wrap>
                              <Form.Item label="潜力过滤" name="potential_filter">
                                <Select mode="multiple" style={{ minWidth: 220 }} options={POTENTIAL_OPTIONS} />
                              </Form.Item>
                              <Form.Item label="Lens 类型" name="lens_type">
                                <Select style={{ width: 220 }} options={LENS_TYPE_OPTIONS} />
                              </Form.Item>
                            </Space>
                            <div>
                              <Button type="primary" onClick={runSupplyTest} loading={supplySubmitting}>
                                开始相似商品测试
                              </Button>
                            </div>
                          </Form>
                          {supplyResult ? (
                            <div style={{ marginTop: 16 }}>
                              <Space wrap size="large" style={{ marginBottom: 16 }}>
                                <Statistic title="成功图片" value={supplyResult.processed_images || 0} />
                                <Statistic title="失败图片" value={supplyResult.failed_images || 0} />
                                <Statistic title="对应商品" value={supplyItems.length} />
                              </Space>
                              {supplyItems.length ? (
                                <Table
                                  rowKey={(record) => record._rowKey}
                                  columns={supplyItemColumns}
                                  dataSource={supplyItems}
                                  pagination={{ pageSize: 5, showSizeChanger: true }}
                                  scroll={{ x: 980 }}
                                />
                              ) : (
                                <Empty description="暂无对应商品结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                              )}
                            </div>
                          ) : null}
                        </Card>
                      </Space>
                    ),
                  },
                ]}
              />
            </Space>
          </div>
        </s-section>
      </s-page>
      <Modal
        title={`编辑监控对象：${editingMonitor?.display_name || editingMonitor?.handle || ""}`}
        open={monitorEditOpen}
        onCancel={() => {
          setMonitorEditOpen(false);
          setEditingMonitor(null);
        }}
        onOk={saveMonitorEdit}
        okText="保存"
        cancelText="取消"
        confirmLoading={monitorUpdating}
        destroyOnHidden
      >
        <Form form={monitorEditForm} layout="vertical">
          <Form.Item label="账号">
            <Input value={editingMonitor ? `${editingMonitor.platform} / ${editingMonitor.handle}` : ""} disabled />
          </Form.Item>
          <Form.Item label="显示名称" name="display_name">
            <Input placeholder="例如：NiKo" allowClear />
          </Form.Item>
          <Form.Item label="评分" name="score">
            <InputNumber min={0} max={10} step={0.5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="状态" name="is_enabled">
            <Select
              options={[
                { value: true, label: "启用" },
                { value: false, label: "停用" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`相似商品：${selectedObject?.category || selectedObject?.id || ""}`}
        open={matchModalOpen}
        onCancel={() => setMatchModalOpen(false)}
        footer={null}
        width={980}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={`当前商品机会 ID：${formatMaybe(selectedObject?.id)}，来源 IP：${formatMaybe(
              getSourceMonitorName(selectedObject),
            )}，识别 IP：${formatMaybe(selectedObject?.related_ip)}，仅展示前三个相似商品`}
          />
          <div>
            <Button
              type="primary"
              loading={supplyMatchObjectId === selectedObject?.id}
              onClick={() => loadObjectProductMatches(selectedObject, true)}
            >
              刷新相似商品
            </Button>
          </div>
          <Table
            rowKey={(record, index) => record.id || getMatchUrl(record) || `${record.title || "match"}-${index}`}
            columns={matchColumns}
            dataSource={matches.items}
            loading={supplyMatchObjectId != null}
            pagination={false}
            scroll={{ x: 860 }}
          />
        </Space>
      </Modal>
      <Modal
        title={`相似商品详情：${selectedSupplyItem?.category || "对应商品"}`}
        open={supplyMatchModalOpen}
        onCancel={() => setSupplyMatchModalOpen(false)}
        footer={null}
        width={1020}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={`来源 IP：${formatMaybe(selectedSupplyItem?.related_ip)}，潜力：${formatMaybe(
              selectedSupplyItem?.ecommerce_potential,
            )}，来源图片：${formatMaybe(selectedSupplyItem?.source_image)}`}
          />
          <Space direction="vertical" size={4}>
            <div>
              <strong>裁剪图片：</strong>
              {formatMaybe(selectedSupplyItem?.crop_path)}
            </div>
            <div>
              <strong>OSS 图片：</strong>
              {selectedSupplyItem?.oss_url ? (
                <a href={selectedSupplyItem.oss_url} target="_blank" rel="noopener noreferrer">
                  打开搜索图片
                </a>
              ) : (
                "—"
              )}
            </div>
            {selectedSupplyItem?.error ? (
              <div>
                <strong>错误：</strong>
                <Tag color="red">{selectedSupplyItem.error}</Tag>
              </div>
            ) : null}
          </Space>
          <Table
            rowKey={(record, index) => getMatchUrl(record) || `${record.title || "match"}-${index}`}
            columns={supplyMatchColumns}
            dataSource={Array.isArray(selectedSupplyItem?.top_matches) ? selectedSupplyItem.top_matches : []}
            pagination={{ pageSize: 6, showSizeChanger: true }}
            scroll={{ x: 920 }}
          />
        </Space>
      </Modal>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
