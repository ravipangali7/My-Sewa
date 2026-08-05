import type { ActivityStatement } from "./activity";
import {
  hasNativeFileBridge,
  isEmbeddedWebView,
  isMySewaNativeApp,
  waitForNativeFileBridge,
} from "./native-app";

/** A4 at 2× for crisp output (points → CSS px ≈ 96/72). */
const SCALE = 2;
const PAGE_W = Math.round(595 * SCALE); // A4 width in pt → px
const PAGE_H = Math.round(842 * SCALE);
const MARGIN = Math.round(48 * SCALE);

const COLORS = {
  brand: "#0a7a4b",
  text: "#1c1c1e",
  muted: "#8e8e93",
  line: "#e5e5ea",
  danger: "#dc2626",
  white: "#ffffff",
  success: "#0a7a4b",
  warning: "#d97706",
  surface: "#ffffff",
};

type Tone = "success" | "danger" | "warning";

function statusTone(status: string): Tone {
  const key = status.toLowerCase();
  if (key === "success" || key === "approved") return "success";
  if (key === "failed" || key === "rejected") return "danger";
  return "warning";
}

function toneColor(tone: Tone): string {
  if (tone === "success") return COLORS.success;
  if (tone === "danger") return COLORS.danger;
  return COLORS.warning;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load logo for PDF"));
    img.src = src;
  });
}

async function drawCircularWatermark(
  ctx: CanvasRenderingContext2D,
  logoUrl: string,
  cx: number,
  cy: number,
  size: number,
  opacity = 0.1,
) {
  const img = await loadImage(logoUrl);
  const radius = size / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = `rgba(10, 122, 75, ${opacity * 0.35})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = opacity;
  ctx.drawImage(img, cx - radius, cy - radius, size, size);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(10, 122, 75, ${opacity * 1.1})`;
  ctx.lineWidth = 2 * SCALE;
  ctx.stroke();
}

function drawStatusBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  tone: Tone,
) {
  ctx.fillStyle = toneColor(tone);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 3.2 * SCALE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  if (tone === "success") {
    ctx.moveTo(cx - 7 * SCALE, cy + 0.5 * SCALE);
    ctx.lineTo(cx - 2 * SCALE, cy + 6 * SCALE);
    ctx.lineTo(cx + 8 * SCALE, cy - 5 * SCALE);
  } else if (tone === "danger") {
    ctx.moveTo(cx - 6 * SCALE, cy - 6 * SCALE);
    ctx.lineTo(cx + 6 * SCALE, cy + 6 * SCALE);
    ctx.moveTo(cx + 6 * SCALE, cy - 6 * SCALE);
    ctx.lineTo(cx - 6 * SCALE, cy + 6 * SCALE);
  } else {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 7 * SCALE);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 6 * SCALE, cy + 3 * SCALE);
  }
  ctx.stroke();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          const trial = chunk + ch;
          if (ctx.measureText(trial).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk = trial;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function safeFilename(reference: string): string {
  const cleaned = reference.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `MySewa_Statement_${cleaned || "transaction"}.pdf`;
}

/** Minimal single-page PDF wrapping a JPEG image (no external deps). */
function jpegToPdfBytes(jpeg: Uint8Array, widthPx: number, heightPx: number): Uint8Array {
  const pageW = widthPx / SCALE;
  const pageH = heightPx / SCALE;
  const encoder = new TextEncoder();

  const out: Uint8Array[] = [];
  let pos = 0;
  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    out.push(bytes);
    pos += bytes.length;
  };
  const objOffsets: number[] = [];

  write("%PDF-1.4\n");

  objOffsets[1] = pos;
  write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  objOffsets[2] = pos;
  write("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  objOffsets[3] = pos;
  write(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`,
  );

  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  objOffsets[4] = pos;
  write(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  objOffsets[5] = pos;
  write(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  write(jpeg);
  write("\nendstream\nendobj\n");

  const xrefPos = pos;
  write(`xref\n0 6\n`);
  write("0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) {
    write(`${String(objOffsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  const total = out.reduce((n, b) => n + b.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of out) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality = 0.92,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode PDF image"));
          return;
        }
        const buffer = await blob.arrayBuffer();
        resolve(new Uint8Array(buffer));
      },
      "image/jpeg",
      quality,
    );
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let binary = "";
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]!);
    }
    parts.push(binary);
  }
  return btoa(parts.join(""));
}

/** Hand the file to the Flutter shell (save and/or open the system share sheet). */
function sendViaNativeBridge(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  type: "download" | "share",
): boolean {
  if (!hasNativeFileBridge()) return false;

  const payload = {
    type,
    filename,
    mime,
    base64: bytesToBase64(bytes),
  };
  const serialized = JSON.stringify(payload);

  try {
    if (window.MySewaNative?.downloadFile?.(payload)) return true;
  } catch {
    // fall through
  }

  try {
    if (window.MySewaBridge?.postMessage) {
      window.MySewaBridge.postMessage(serialized);
      return true;
    }
  } catch {
    // fall through
  }

  return false;
}

/**
 * Browser / WebView-safe download.
 * Never navigates the main frame to blob: (that breaks Flutter WebView).
 */
async function triggerDownload(bytes: Uint8Array, filename: string, mime: string) {
  if (isMySewaNativeApp()) {
    await waitForNativeFileBridge();
  }
  if (sendViaNativeBridge(bytes, filename, mime, "download")) return;

  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: mime });

  const nav = window.navigator as Navigator & {
    msSaveOrOpenBlob?: (blob: Blob, name?: string) => boolean;
  };
  if (typeof nav.msSaveOrOpenBlob === "function") {
    nav.msSaveOrOpenBlob(blob, filename);
    return;
  }

  // Desktop / normal browsers
  if (!isEmbeddedWebView() && !isMySewaNativeApp()) {
    const url = URL.createObjectURL(blob);
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

  // Embedded WebView without bridge: data URL via hidden iframe (no main-frame nav)
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = dataUrl;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 60_000);

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function triggerShare(bytes: Uint8Array, filename: string, mime: string) {
  if (isMySewaNativeApp()) {
    await waitForNativeFileBridge();
  }
  if (sendViaNativeBridge(bytes, filename, mime, "share")) return;

  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: mime });
  const file = new File([blob], filename, { type: mime });
  const nav = window.navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };

  if (typeof nav.share === "function") {
    const data: ShareData = { title: filename, text: "MySewa statement", files: [file] };
    try {
      if (!nav.canShare || nav.canShare(data)) {
        await nav.share(data);
        return;
      }
    } catch (err) {
      // User cancel should not fall through to a download.
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }

  await triggerDownload(bytes, filename, mime);
}

export interface StatementPdfOptions {
  statement: ActivityStatement;
  title: string;
  detailsHeading: string;
  logoUrl: string;
  brandName?: string;
}

async function buildStatementPdfBytes({
  statement,
  title,
  detailsHeading,
  logoUrl,
  brandName = "MySewa",
}: StatementPdfOptions): Promise<{ bytes: Uint8Array; filename: string }> {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const tone = statusTone(statement.item.status);
  const contentW = PAGE_W - MARGIN * 2;

  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  ctx.fillStyle = COLORS.text;
  ctx.font = `600 ${18 * SCALE}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, PAGE_W / 2, 56 * SCALE);

  drawStatusBadge(ctx, PAGE_W / 2, 100 * SCALE, 22 * SCALE, tone);

  let y = 150 * SCALE;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.brand;
  ctx.font = `600 ${12 * SCALE}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.fillText(detailsHeading, MARGIN, y);

  y += 18 * SCALE;
  const detailsTop = y;
  const estimatedBottom = detailsTop + statement.details.length * 28 * SCALE;
  const watermarkSize = 160 * SCALE;
  const watermarkCy =
    detailsTop + Math.max(watermarkSize / 2, (estimatedBottom - detailsTop) / 2);

  try {
    await drawCircularWatermark(
      ctx,
      logoUrl,
      PAGE_W / 2,
      watermarkCy,
      watermarkSize,
    );
  } catch {
    // Continue without watermark if logo cannot be loaded.
  }

  const valueMaxW = contentW * 0.55;
  for (const row of statement.details) {
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1 * SCALE;
    ctx.beginPath();
    ctx.moveTo(MARGIN, y + 14 * SCALE);
    ctx.lineTo(MARGIN + contentW, y + 14 * SCALE);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;
    ctx.font = `400 ${10 * SCALE}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillText(row.label, MARGIN, y + 8 * SCALE);

    ctx.textAlign = "right";
    ctx.fillStyle = row.danger ? COLORS.danger : COLORS.text;
    ctx.font = row.mono
      ? `400 ${9 * SCALE}px ui-monospace, SFMono-Regular, Menlo, monospace`
      : `600 ${10 * SCALE}px system-ui, -apple-system, Segoe UI, sans-serif`;

    const lines = wrapText(ctx, row.value, valueMaxW);
    lines.forEach((line, i) => {
      ctx.fillText(line, MARGIN + contentW, y + 8 * SCALE + i * 12 * SCALE);
    });

    y += Math.max(28 * SCALE, lines.length * 12 * SCALE + 12 * SCALE);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.muted;
  ctx.font = `400 ${8 * SCALE}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const footerLines = wrapText(ctx, statement.footer, contentW);
  let footerY = PAGE_H - 40 * SCALE;
  footerLines.forEach((line) => {
    ctx.fillText(line, MARGIN, footerY);
    footerY += 11 * SCALE;
  });
  ctx.textAlign = "right";
  ctx.fillText(brandName, MARGIN + contentW, PAGE_H - 24 * SCALE);

  const jpeg = await canvasToJpegBytes(canvas);
  const bytes = jpegToPdfBytes(jpeg, PAGE_W, PAGE_H);
  return { bytes, filename: safeFilename(statement.reference) };
}

export async function downloadStatementPdf(options: StatementPdfOptions): Promise<void> {
  const { bytes, filename } = await buildStatementPdfBytes(options);
  await triggerDownload(bytes, filename, "application/pdf");
}

export async function shareStatementPdf(options: StatementPdfOptions): Promise<void> {
  const { bytes, filename } = await buildStatementPdfBytes(options);
  await triggerShare(bytes, filename, "application/pdf");
}
