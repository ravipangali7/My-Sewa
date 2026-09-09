import {
  hasNativeFileBridge,
  isEmbeddedWebView,
  isMySewaNativeApp,
  waitForNativeFileBridge,
} from "./native-app";

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
  if (typeof window === "undefined") return false;
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

function waitForNativeSave(filename: string, timeoutMs = 45_000): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("mysewa-file-saved", onEvent as EventListener);
      resolve(ok);
    };
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ success?: boolean; filename?: string }>).detail;
      if (detail?.filename && detail.filename !== filename) return;
      finish(detail?.success !== false);
    };
    window.addEventListener("mysewa-file-saved", onEvent as EventListener);
    window.setTimeout(() => finish(true), timeoutMs);
  });
}

/**
 * Save a Blob on device. In the Flutter app this goes through the native
 * Downloads folder so Files / File Manager can open it.
 */
export async function downloadBlobToDevice(
  blob: Blob,
  filename: string,
  mime = blob.type || "application/octet-stream",
): Promise<void> {
  if (isMySewaNativeApp()) {
    await waitForNativeFileBridge();
    const base64 = await blobToBase64(blob);
    if (sendViaNativeBridge(base64, filename, mime || blob.type || "application/octet-stream")) {
      await waitForNativeSave(filename);
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
