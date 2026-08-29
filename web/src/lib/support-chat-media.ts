import { apiBlob, getApiBase } from "@/lib/api";
import {
  hasNativeFileBridge,
  isEmbeddedWebView,
  isMySewaNativeApp,
  waitForNativeFileBridge,
} from "@/lib/native-app";

const blobUrlCache = new Map<string, string>();
const blobCache = new Map<string, Blob>();

export const SUPPORT_CHAT_ACCEPT_FILES =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar,.7z,.ppt,.pptx,.rtf,.odt,.ods,application/pdf";
export const SUPPORT_CHAT_ACCEPT_MEDIA = "image/*,video/*";
export const SUPPORT_CHAT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const SUPPORT_CHAT_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const SUPPORT_CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export function supportChatAttachmentPath(
  threadId: number,
  messageId: number,
  download = false,
) {
  const suffix = download ? "?download=1" : "";
  return `/api/support-chat/threads/${threadId}/messages/${messageId}/attachment/${suffix}`;
}

export function absoluteApiUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${getApiBase()}${path}`;
}

export async function authorizedBlob(path: string): Promise<Blob> {
  const cached = blobCache.get(path);
  if (cached) return cached;
  const blob = await apiBlob(path);
  blobCache.set(path, blob);
  return blob;
}

export async function authorizedObjectUrl(path: string): Promise<string> {
  const cached = blobUrlCache.get(path);
  if (cached) return cached;
  const blob = await authorizedBlob(path);
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(path, url);
  return url;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function sendViaNativeBridge(base64: string, filename: string, mime: string): boolean {
  if (!hasNativeFileBridge()) return false;
  const payload = { type: "download", filename, mime, base64 };
  try {
    if (window.MySewaNative?.downloadFile?.(payload)) return true;
  } catch {
    /* fall through */
  }
  try {
    if (window.MySewaBridge?.postMessage) {
      window.MySewaBridge.postMessage(JSON.stringify(payload));
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function downloadAuthorizedAttachment(
  path: string,
  filename: string,
  mime = "application/octet-stream",
) {
  const blob = await authorizedBlob(path);
  if (isMySewaNativeApp()) {
    await waitForNativeFileBridge();
    const base64 = await blobToBase64(blob);
    if (sendViaNativeBridge(base64, filename, mime || blob.type || "application/octet-stream")) {
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  if (!isEmbeddedWebView() && !isMySewaNativeApp()) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    iframe.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

export function classifyLocalFile(file: File): "image" | "video" | "file" {
  if (file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(file.name)) {
    return "image";
  }
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm|3gp|m4v|avi)$/i.test(file.name)) {
    return "video";
  }
  return "file";
}

export function maxBytesForKind(kind: "image" | "video" | "file") {
  if (kind === "image") return SUPPORT_CHAT_MAX_IMAGE_BYTES;
  if (kind === "video") return SUPPORT_CHAT_MAX_VIDEO_BYTES;
  return SUPPORT_CHAT_MAX_FILE_BYTES;
}

const ALLOWED_EXT =
  /\.(jpe?g|png|gif|webp|heic|heif|bmp|mp4|mov|webm|3gp|m4v|avi|pdf|docx?|xlsx?|csv|txt|zip|rar|7z|pptx?|rtf|odt|ods)$/i;

export function isAllowedChatFile(file: File) {
  if (ALLOWED_EXT.test(file.name)) return true;
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}
