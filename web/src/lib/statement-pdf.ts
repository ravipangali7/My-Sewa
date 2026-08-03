import { jsPDF } from "jspdf";
import type { ActivityStatement } from "./activity";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const COLORS = {
  brand: [10, 122, 75] as const,
  text: [28, 28, 30] as const,
  muted: [142, 142, 147] as const,
  line: [229, 229, 234] as const,
  danger: [220, 38, 38] as const,
  white: [255, 255, 255] as const,
  success: [10, 122, 75] as const,
  warning: [217, 119, 6] as const,
};

type Tone = "success" | "danger" | "warning";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load logo for PDF"));
    img.src = src;
  });
}

/** Circular, light logo watermark as a PNG data URL. */
async function createCircularWatermark(
  logoUrl: string,
  sizePx = 720,
  opacity = 0.12,
): Promise<string> {
  const img = await loadImage(logoUrl);
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const cx = sizePx / 2;
  const cy = sizePx / 2;
  const radius = sizePx / 2 - 4;

  ctx.clearRect(0, 0, sizePx, sizePx);

  // Soft circular plate behind the logo
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = `rgba(10, 122, 75, ${opacity * 0.35})`;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = opacity;
  ctx.drawImage(img, 0, 0, sizePx, sizePx);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(10, 122, 75, ${opacity * 1.1})`;
  ctx.lineWidth = 3;
  ctx.stroke();

  return canvas.toDataURL("image/png");
}

function statusTone(status: string): Tone {
  const key = status.toLowerCase();
  if (key === "success" || key === "approved") return "success";
  if (key === "failed" || key === "rejected") return "danger";
  return "warning";
}

function toneRgb(tone: Tone): readonly [number, number, number] {
  if (tone === "success") return COLORS.success;
  if (tone === "danger") return COLORS.danger;
  return COLORS.warning;
}

function drawStatusBadge(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  tone: Tone,
) {
  const [r, g, b] = toneRgb(tone);
  doc.setFillColor(r, g, b);
  doc.circle(cx, cy, radius, "F");
  doc.setDrawColor(...COLORS.white);
  doc.setLineWidth(2.4);
  doc.setLineCap("round");
  doc.setLineJoin("round");

  if (tone === "success") {
    doc.line(cx - 5.5, cy + 0.5, cx - 1.5, cy + 4.5);
    doc.line(cx - 1.5, cy + 4.5, cx + 6.5, cy - 4);
  } else if (tone === "danger") {
    doc.line(cx - 5, cy - 5, cx + 5, cy + 5);
    doc.line(cx + 5, cy - 5, cx - 5, cy + 5);
  } else {
    // Clock hands
    doc.line(cx, cy, cx, cy - 5.5);
    doc.line(cx, cy, cx + 4.5, cy + 2.5);
  }
}

function safeFilename(reference: string): string {
  const cleaned = reference.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `MySewa_Statement_${cleaned || "transaction"}.pdf`;
}

export interface StatementPdfOptions {
  statement: ActivityStatement;
  title: string;
  detailsHeading: string;
  logoUrl: string;
  brandName?: string;
}

export async function downloadStatementPdf({
  statement,
  title,
  detailsHeading,
  logoUrl,
  brandName = "MySewa",
}: StatementPdfOptions): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const tone = statusTone(statement.item.status);

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COLORS.text);
  doc.text(title, PAGE_WIDTH / 2, 28, { align: "center" });

  // Status badge
  drawStatusBadge(doc, PAGE_WIDTH / 2, 48, 12, tone);

  // Details heading
  let y = 72;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.brand);
  doc.text(detailsHeading, MARGIN_X, y);

  y += 6;
  const detailsTop = y;
  const rowH = 9;
  const detailsBottom = detailsTop + statement.details.length * rowH + 4;
  const watermarkSize = 78;
  const watermarkY =
    detailsTop + Math.max(8, (detailsBottom - detailsTop - watermarkSize) / 2);

  // Circular logo watermark behind detail rows
  try {
    const watermark = await createCircularWatermark(logoUrl);
    doc.addImage(
      watermark,
      "PNG",
      (PAGE_WIDTH - watermarkSize) / 2,
      watermarkY,
      watermarkSize,
      watermarkSize,
      undefined,
      "FAST",
    );
  } catch {
    // Continue without watermark if logo cannot be loaded (CORS / offline).
  }

  // Detail rows
  for (const row of statement.details) {
    doc.setDrawColor(...COLORS.line);
    doc.setLineWidth(0.25);
    doc.line(MARGIN_X, y + 5.5, MARGIN_X + CONTENT_WIDTH, y + 5.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.muted);
    doc.text(row.label, MARGIN_X, y + 3.8);

    doc.setFont("helvetica", row.mono ? "normal" : "bold");
    doc.setFontSize(row.mono ? 9 : 10);
    if (row.danger) {
      doc.setTextColor(...COLORS.danger);
    } else {
      doc.setTextColor(...COLORS.text);
    }

    const valueLines = doc.splitTextToSize(row.value, CONTENT_WIDTH * 0.55);
    doc.text(valueLines, MARGIN_X + CONTENT_WIDTH, y + 3.8, {
      align: "right",
    });

    y += Math.max(rowH, valueLines.length * 4.2 + 4);
    if (y > PAGE_HEIGHT - 28) {
      doc.addPage();
      y = 24;
    }
  }

  // Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  const footer = doc.splitTextToSize(statement.footer, CONTENT_WIDTH);
  doc.text(footer, MARGIN_X, PAGE_HEIGHT - 18);
  doc.text(brandName, MARGIN_X + CONTENT_WIDTH, PAGE_HEIGHT - 12, {
    align: "right",
  });

  doc.save(safeFilename(statement.reference));
}
