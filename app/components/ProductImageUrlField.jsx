import { useEffect, useState } from "react";
import { Collapse, Form, Input, Upload, message } from "antd";
import { authFetch } from "../utils/auth-api";

const UPLOAD_STANDALONE_IMAGE_URL = "/api/v1/upload/standalone/file";

const MAX_MB = 8;

/**
 * 商品主图：默认用本地上传（standalone 接口返回的 url 写入表单）；可选展开手动填 URL。
 */
export function ProductImageUrlField({ name = "image_url" }) {
  const form = Form.useFormInstance();
  const url = Form.useWatch(name, form);
  const [fileList, setFileList] = useState([]);

  // 表单里已有 url（如编辑回显）时，同步到 Upload 预览
  useEffect(() => {
    if (url) {
      setFileList([
        {
          uid: "-main",
          name: "主图",
          status: "done",
          url,
          thumbUrl: url,
          response: { url },
        },
      ]);
    } else {
      setFileList([]);
    }
  }, [url]);

  const customRequest = async ({ file, onSuccess, onError }) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await authFetch(UPLOAD_STANDALONE_IMAGE_URL, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail || json?.message || json?.data?.message || "上传失败";
        throw new Error(typeof detail === "string" ? detail : "上传失败");
      }
      const signedUrl = json?.data?.url;
      if (!signedUrl) {
        throw new Error("接口未返回 url");
      }
      form.setFieldValue(name, signedUrl);
      message.success("图片已上传");
      onSuccess?.(json.data, file);
    } catch (e) {
      if (e instanceof Error && e.message === "AUTH_EXPIRED") {
        message.error("登录已过期，请重新登录后再上传");
      } else {
        message.error(e instanceof Error ? e.message : "上传失败");
      }
      onError?.(e);
    }
  };

  const beforeUpload = (file) => {
    const isImage = file.type?.startsWith("image/");
    if (!isImage) {
      message.error("请上传图片文件（如 JPG、PNG、WebP）");
      return false;
    }
    if (file.size / 1024 / 1024 > MAX_MB) {
      message.error(`图片需小于 ${MAX_MB}MB`);
      return false;
    }
    return true;
  };

  const handleChange = ({ fileList: next }) => {
    setFileList(next);
  };

  const handleRemove = () => {
    form.setFieldValue(name, "");
    setFileList([]);
    return true;
  };

  return (
    <div>
      <Form.Item name={name} hidden>
        <Input />
      </Form.Item>

      <div style={{ marginBottom: 8 }}>
        <span style={{ display: "inline-block", marginBottom: 8, fontWeight: 500 }}>商品主图</span>
        <Upload
          accept="image/*"
          listType="picture-card"
          maxCount={1}
          fileList={fileList}
          onChange={handleChange}
          beforeUpload={beforeUpload}
          customRequest={customRequest}
          onRemove={handleRemove}
        >
          {fileList.length >= 1 ? null : (
            <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>+</div>
              <div>上传</div>
            </div>
          )}
        </Upload>
        <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>
          支持常见图片格式，单张不超过 {MAX_MB}MB。需已登录且为平台自注册商户。
        </div>
      </div>

      <Collapse
        size="small"
        items={[
          {
            key: "manual-url",
            label: "手动填写图片链接（可选）",
            children: (
              <Input
                placeholder="https://..."
                value={url || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  form.setFieldValue(name, v || "");
                }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
