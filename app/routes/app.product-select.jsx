import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  Alert,
  Button,
  Card,
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

const PROFILE_SOURCE_OPTIONS = [
  { value: "ai", label: "AI 预测" },
  { value: "match", label: "参考相似商品" },
  { value: "manual", label: "人工填写" },
];

const PROFILE_STATUS_OPTIONS = [
  { value: "draft", label: "draft 草稿" },
  { value: "confirmed", label: "confirmed 已确认" },
];

const WEIGHT_UNIT_OPTIONS = [
  { value: "g", label: "g 克" },
  { value: "kg", label: "kg 千克" },
  { value: "lb", label: "lb 磅" },
  { value: "oz", label: "oz 盎司" },
];

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "EUR", label: "EUR" },
];

function pickResponseData(json) {
  return json?.data && typeof json.data === "object" ? json.data : json;
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

function getObjectCropImageUrl(record) {
  return record?.crop_image?.oss_url || "";
}

function getObjectSourceImageUrl(record) {
  const img = record?.source_image;
  return img?.oss_url || img?.source_url || "";
}

function getObjectPreviewImage(record) {
  return getObjectCropImageUrl(record) || getObjectSourceImageUrl(record);
}

function normalizeBboxStyle(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const nums = bbox.map((v) => Number(v));
  if (nums.some((n) => Number.isNaN(n))) return null;
  const [x1, y1, x2, y2] = nums;
  if (x2 <= x1 || y2 <= y1) return null;
  return {
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    width: `${(x2 - x1) * 100}%`,
    height: `${(y2 - y1) * 100}%`,
  };
}

function CropImagePreview({ record, onViewSource }) {
  const cropUrl = getObjectCropImageUrl(record);
  const sourceUrl = getObjectSourceImageUrl(record);

  if (!cropUrl) {
    return <Empty description="暂无裁剪图" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <img
        src={cropUrl}
        alt={record?.category || "裁剪图"}
        style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto", borderRadius: 8 }}
      />
      <Alert type="info" showIcon message="由识图 bbox 从原图裁剪生成，用于相似商品搜索。" />
      {sourceUrl && onViewSource ? (
        <Button type="link" style={{ padding: 0 }} onClick={onViewSource}>
          查看对应原图
        </Button>
      ) : null}
    </Space>
  );
}

function SourceImagePreview({ record, onViewCrop }) {
  const sourceUrl = getObjectSourceImageUrl(record);
  const cropUrl = getObjectCropImageUrl(record);
  const bboxStyle = normalizeBboxStyle(record?.bbox);

  if (!sourceUrl) {
    return <Empty description="暂无可用原图" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
        <img
          src={sourceUrl}
          alt={record?.category || "原图"}
          style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", borderRadius: 8 }}
        />
        {bboxStyle ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              boxSizing: "border-box",
              border: "2px solid #ff4d4f",
              background: "rgba(255, 77, 79, 0.15)",
              pointerEvents: "none",
              ...bboxStyle,
            }}
          />
        ) : null}
      </div>
      {bboxStyle ? (
        <Alert type="info" showIcon message="红框为识图时标注的商品区域，对应下方裁剪图。" />
      ) : (
        <Alert type="warning" showIcon message="该商品机会暂无 bbox，仅展示原图。" />
      )}
      {cropUrl ? (
        <div>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>对应裁剪图</div>
          {onViewCrop ? (
            <button
              type="button"
              onClick={onViewCrop}
              style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}
            >
              <img
                src={cropUrl}
                alt={record?.category || "裁剪图"}
                style={{ maxWidth: 240, maxHeight: 240, objectFit: "contain", borderRadius: 8, border: "1px solid #f0f0f0" }}
              />
            </button>
          ) : (
            <img
              src={cropUrl}
              alt={record?.category || "裁剪图"}
              style={{ maxWidth: 240, maxHeight: 240, objectFit: "contain", borderRadius: 8, border: "1px solid #f0f0f0" }}
            />
          )}
        </div>
      ) : null}
    </Space>
  );
}

function getSourceMonitorName(record) {
  return record?.source_monitor?.display_name || record?.source_monitor?.handle || "";
}

function formatMatchPrice(match) {
  if (match?.price_text) return match.price_text;
  if (match?.price == null) return "—";
  return `${match.currency || ""}${match.price}`;
}

function profileToFormValues(profile) {
  return {
    cost_price_min: profile?.cost_price_min ?? null,
    cost_price_max: profile?.cost_price_max ?? null,
    selling_price_min: profile?.selling_price_min ?? null,
    selling_price_max: profile?.selling_price_max ?? null,
    currency: profile?.currency || "USD",
    length_cm: profile?.length_cm ?? null,
    width_cm: profile?.width_cm ?? null,
    height_cm: profile?.height_cm ?? null,
    volume_cm3: profile?.volume_cm3 ?? null,
    weight_value: profile?.weight_value ?? null,
    weight_unit: profile?.weight_unit ?? null,
    source: profile?.source || "ai",
    status: profile?.status || "draft",
    reference_match_id: profile?.reference_match_id ?? null,
    notes: profile?.notes || "",
  };
}

function buildProfilePayload(values) {
  const payload = {};
  const numericFields = [
    "cost_price_min",
    "cost_price_max",
    "selling_price_min",
    "selling_price_max",
    "length_cm",
    "width_cm",
    "height_cm",
    "volume_cm3",
    "weight_value",
    "reference_match_id",
  ];
  for (const key of numericFields) {
    if (values[key] !== undefined && values[key] !== null && values[key] !== "") {
      payload[key] = values[key];
    }
  }
  if (values.currency) payload.currency = String(values.currency).trim().toUpperCase();
  if (values.weight_unit) payload.weight_unit = values.weight_unit;
  if (values.source) payload.source = values.source;
  if (values.status) payload.status = values.status;
  if (values.notes != null && String(values.notes).trim()) {
    payload.notes = String(values.notes).trim();
  }
  return payload;
}

function validateProfilePayload(payload) {
  if (
    payload.cost_price_min != null &&
    payload.cost_price_max != null &&
    payload.cost_price_min > payload.cost_price_max
  ) {
    return "采购成本下限不能大于上限";
  }
  if (
    payload.selling_price_min != null &&
    payload.selling_price_max != null &&
    payload.selling_price_min > payload.selling_price_max
  ) {
    return "售价下限不能大于上限";
  }
  if (payload.weight_value != null && !payload.weight_unit) {
    return "填写重量时必须选择单位";
  }
  return "";
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
  const [objectForm] = Form.useForm();
  const [profileForm] = Form.useForm();

  const [monitorListLoading, setMonitorListLoading] = useState(false);
  const [monitorUpdating, setMonitorUpdating] = useState(false);
  const [monitorSubmitting, setMonitorSubmitting] = useState(false);
  const [objectLoading, setObjectLoading] = useState(false);
  const [supplyMatchObjectId, setSupplyMatchObjectId] = useState(null);

  const [monitors, setMonitors] = useState({ items: [], returned_count: 0 });
  const [selectedMonitors, setSelectedMonitors] = useState([]);
  const [monitorListError, setMonitorListError] = useState("");
  const [monitorResult, setMonitorResult] = useState(null);
  const [editingMonitor, setEditingMonitor] = useState(null);
  const [monitorEditOpen, setMonitorEditOpen] = useState(false);
  const [objects, setObjects] = useState({ items: [], returned_count: 0 });
  const [objectFilters, setObjectFilters] = useState({});
  const [objectError, setObjectError] = useState("");
  const [matches, setMatches] = useState({ items: [], returned_count: 0 });
  const [selectedObject, setSelectedObject] = useState(null);
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [objectImagePreview, setObjectImagePreview] = useState(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileObject, setProfileObject] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const openObjectImagePreview = (record, type) => {
    const hasCrop = Boolean(getObjectCropImageUrl(record));
    const hasSource = Boolean(getObjectSourceImageUrl(record));
    if (type === "crop" && !hasCrop) return;
    if (type === "source" && !hasSource) return;
    setObjectImagePreview({ record, type });
  };

  const closeObjectImagePreview = () => {
    setObjectImagePreview(null);
  };

  const updateObjectInList = (objectId, patch) => {
    setObjects((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === objectId ? { ...item, ...patch } : item)),
    }));
  };

  const openProfileModal = async (record) => {
    if (!record?.id) return;
    setProfileObject(record);
    setProfileModalOpen(true);
    profileForm.setFieldsValue(profileToFormValues(record.profile));
    try {
      const res = await authFetch(`${PRODUCT_SELECT_BASE}/objects/${record.id}/profile`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const data = pickResponseData(json);
      if (data && typeof data === "object") {
        profileForm.setFieldsValue(profileToFormValues(data));
        updateObjectInList(record.id, { profile: data });
        setProfileObject((current) => (current?.id === record.id ? { ...current, profile: data } : current));
      }
    } catch {
      // 列表里已有 profile 时仍可用；拉取失败不阻断编辑。
    }
  };

  const closeProfileModal = () => {
    setProfileModalOpen(false);
    setProfileObject(null);
    profileForm.resetFields();
  };

  const saveProfile = async () => {
    if (!profileObject?.id) return;
    try {
      const values = await profileForm.validateFields();
      const payload = buildProfilePayload(values);
      const validationError = validateProfilePayload(payload);
      if (validationError) {
        message.error(validationError);
        return;
      }
      const hasExisting = Boolean(profileObject.profile?.id);
      const method = hasExisting ? "PATCH" : "PUT";
      setProfileSaving(true);
      const res = await authFetch(`${PRODUCT_SELECT_BASE}/objects/${profileObject.id}/profile`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || `保存失败: ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : "商品预估保存失败");
      }
      const data = pickResponseData(json);
      updateObjectInList(profileObject.id, { profile: data });
      message.success(hasExisting ? "商品预估已更新" : "商品预估已创建");
      closeProfileModal();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e instanceof Error ? e.message : "商品预估保存失败");
    } finally {
      setProfileSaving(false);
    }
  };

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

  const loadObjects = useCallback(
    async (values = objectForm.getFieldsValue()) => {
      setObjectLoading(true);
      setObjectError("");
      try {
        const params = new URLSearchParams();
        if (values.category) params.set("category", values.category.trim());
        if (values.include_inactive) params.set("include_inactive", "true");
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

  const deleteObjectOpportunity = async (record) => {
    if (!record?.id) return;
    Modal.confirm({
      title: "删除商品机会",
      content: `确认删除「${record.category || record.id}」吗？删除后默认列表将不再显示。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        const res = await authFetch(`${PRODUCT_SELECT_BASE}/objects/${record.id}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = json?.detail || json?.message || `删除失败: ${res.status}`;
          throw new Error(typeof detail === "string" ? detail : "商品机会删除失败");
        }
        setObjects((current) => ({
          items: current.items.filter((item) => item.id !== record.id),
          returned_count: Math.max(0, (Number(current.returned_count) || 0) - 1),
        }));
        message.success("商品机会已删除");
      },
    });
  };

  useEffect(() => {
    loadMonitors();
  }, [loadMonitors]);

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

  const categoryOptions = useMemo(() => {
    const values = new Set();
    for (const item of objects.items) {
      if (item.category) values.add(String(item.category));
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
        const previewType = getObjectCropImageUrl(record) ? "crop" : "source";
        return image ? (
          <button
            type="button"
            onClick={() => openObjectImagePreview(record, previewType)}
            style={{
              padding: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
              lineHeight: 0,
            }}
            aria-label={`查看${previewType === "crop" ? "裁剪图" : "原图"}`}
          >
            <img
              src={image}
              alt={record.category || "商品机会"}
              style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }}
            />
          </button>
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
            <Tag color={record.is_active === false ? "default" : "green"}>
              v{record.recognition_version || 1}
              {record.is_active === false ? " 历史" : " 当前"}
            </Tag>
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
      title: "描述",
      key: "description",
      width: 320,
      render: (_, record) => (
        <div style={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-word" }}>
          <div>
            <strong>说明：</strong>
            {formatMaybe(record.description)}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>属性：</strong>
            {formatMaybe(record.attributes)}
          </div>
          <div style={{ color: "var(--dash-muted)", marginTop: 4 }}>
            <strong>推荐：</strong>
            {formatMaybe(record.reason)}
          </div>
        </div>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 150,
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
              disabled={!getObjectSourceImageUrl(record)}
              onClick={() => openObjectImagePreview(record, "source")}
            >
              查看原图
            </Button>
            <Button type="link" style={{ padding: 0 }} onClick={() => openProfileModal(record)}>
              编辑商品预估
            </Button>
            <Button
              type="link"
              style={{ padding: 0 }}
              loading={supplyMatchObjectId === record.id}
              onClick={() => loadObjectProductMatches(record, false)}
            >
              查看相似商品
            </Button>
            <Button
              type="link"
              danger
              style={{ padding: 0 }}
              onClick={() => deleteObjectOpportunity(record)}
            >
              删除商品机会
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
                    pagination={{ defaultPageSize: 5, showSizeChanger: true, pageSizeOptions: [5, 6, 10, 20, 50] }}
                    scroll={{ x: 900 }}
                  />
                )}
              </Card>

              <Card title="2. IP 监控">
                <Form
                  form={monitorForm}
                  layout="vertical"
                  initialValues={{ posts_per_profile: 3, max_images_per_post: 4 }}
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

              <Card title="3. 商品机会">
                <Form
                  form={objectForm}
                  layout="inline"
                  initialValues={{ include_inactive: false }}
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
                    <Select
                      placeholder="选择品类"
                      style={{ width: 180 }}
                      allowClear
                      showSearch
                      options={categoryOptions}
                      optionFilterProp="label"
                    />
                  </Form.Item>
                  <Form.Item label="历史版本" name="include_inactive">
                    <Select
                      style={{ width: 120 }}
                      options={[
                        { value: false, label: "隐藏" },
                        { value: true, label: "显示" },
                      ]}
                    />
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
        title={
          objectImagePreview?.type === "crop"
            ? `裁剪图：${objectImagePreview?.record?.category || objectImagePreview?.record?.id || ""}`
            : `原图：${objectImagePreview?.record?.category || objectImagePreview?.record?.id || ""}`
        }
        open={Boolean(objectImagePreview)}
        onCancel={closeObjectImagePreview}
        footer={null}
        width={900}
        destroyOnHidden
      >
        {objectImagePreview?.record ? (
          objectImagePreview.type === "crop" ? (
            <CropImagePreview
              record={objectImagePreview.record}
              onViewSource={() => openObjectImagePreview(objectImagePreview.record, "source")}
            />
          ) : (
            <SourceImagePreview
              record={objectImagePreview.record}
              onViewCrop={() => openObjectImagePreview(objectImagePreview.record, "crop")}
            />
          )
        ) : null}
      </Modal>
      <Modal
        title={`商品预估参数：${profileObject?.category || profileObject?.id || ""}`}
        open={profileModalOpen}
        onCancel={closeProfileModal}
        onOk={saveProfile}
        okText="保存"
        cancelText="取消"
        confirmLoading={profileSaving}
        width={720}
        destroyOnHidden
      >
        <Form
          form={profileForm}
          layout="vertical"
          initialValues={profileToFormValues(null)}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="由识图自动生成预估参数（采购/售价区间、尺寸重量等），可按需人工修改。"
          />
          <div style={{ fontWeight: 600, marginBottom: 8 }}>价格区间</div>
          <Space wrap size="middle" style={{ width: "100%" }}>
            <Form.Item label="采购成本下限" name="cost_price_min">
              <InputNumber min={0} step={0.01} style={{ width: 140 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="采购成本上限" name="cost_price_max">
              <InputNumber min={0} step={0.01} style={{ width: 140 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="售价下限" name="selling_price_min">
              <InputNumber min={0} step={0.01} style={{ width: 140 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="售价上限" name="selling_price_max">
              <InputNumber min={0} step={0.01} style={{ width: 140 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="币种" name="currency">
              <Select style={{ width: 100 }} options={CURRENCY_OPTIONS} />
            </Form.Item>
          </Space>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>尺寸与重量（可选）</div>
          <Space wrap size="middle" style={{ width: "100%" }}>
            <Form.Item label="长 (cm)" name="length_cm">
              <InputNumber min={0} step={0.1} style={{ width: 120 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="宽 (cm)" name="width_cm">
              <InputNumber min={0} step={0.1} style={{ width: 120 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="高 (cm)" name="height_cm">
              <InputNumber min={0} step={0.1} style={{ width: 120 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="体积 (cm³)" name="volume_cm3">
              <InputNumber min={0} step={0.1} style={{ width: 120 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="重量" name="weight_value">
              <InputNumber min={0} step={0.001} style={{ width: 120 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="单位" name="weight_unit">
              <Select allowClear style={{ width: 120 }} placeholder="可选" options={WEIGHT_UNIT_OPTIONS} />
            </Form.Item>
          </Space>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>元数据</div>
          <Space wrap size="middle" style={{ width: "100%" }}>
            <Form.Item label="来源" name="source">
              <Select style={{ width: 160 }} options={PROFILE_SOURCE_OPTIONS} />
            </Form.Item>
            <Form.Item label="状态" name="status">
              <Select style={{ width: 160 }} options={PROFILE_STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item label="参考相似商品 ID" name="reference_match_id">
              <InputNumber min={1} step={1} style={{ width: 160 }} placeholder="可选" />
            </Form.Item>
          </Space>
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={3} placeholder="预测依据、供应商信息等" allowClear />
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
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
