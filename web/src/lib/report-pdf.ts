import type { AdminReportData } from "./types";
import { formatNPR } from "./format";

const SCALE = 2;
const PAGE_W = Math.round(595 * SCALE);
const PAGE_H = Math.round(842 * SCALE);
const MARGIN = Math.round(48 * SCALE);

const COLORS = {
  brand: "#0a7a4b",
  text: "#1c1c1e",
  muted: "#8e8e93",
  line: "#e5e5ea",
  surface: "#ffffff",
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load logo"));
    img.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

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
  write("xref\n0 6\n");
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

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode PDF image"));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      "image/jpeg",
      0.92,
    );
  });
}

async function triggerDownload(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadReportPdf({
  report,
  title,
  periodLabel,
  logoUrl,
  brandName,
  serviceLabels,
}: {
  report: AdminReportData;
  title: string;
  periodLabel: string;
  logoUrl?: string;
  brandName: string;
  serviceLabels: Record<string, string>;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const contentW = PAGE_W - MARGIN * 2;
  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  let y = 56 * SCALE;

  if (logoUrl) {
    try {
      const img = await loadImage(logoUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(MARGIN + 20 * SCALE, y, 20 * SCALE, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, MARGIN, y - 20 * SCALE, 40 * SCALE, 40 * SCALE);
      ctx.restore();
    } catch {
      // skip logo
    }
  }

  ctx.fillStyle = COLORS.brand;
  ctx.font = `600 ${14 * SCALE}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(brandName, MARGIN + 52 * SCALE, y);

  y += 36 * SCALE;
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 ${20 * SCALE}px system-ui, sans-serif`;
  ctx.fillText(title, MARGIN, y);

  y += 24 * SCALE;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `400 ${11 * SCALE}px system-ui, sans-serif`;
  ctx.fillText(periodLabel, MARGIN, y);

  y += 32 * SCALE;
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 ${13 * SCALE}px system-ui, sans-serif`;
  ctx.fillText("Summary", MARGIN, y);
  y += 20 * SCALE;

  const summary = report.summary;
  const summaryRows = [
    ["Total transactions", String(summary.total_count), formatNPR(summary.total_amount)],
    ["Successful", String(summary.success_count), formatNPR(summary.success_amount)],
    ["Pending", String(summary.pending_count), formatNPR(summary.pending_amount)],
    ["Failed", String(summary.failed_count), formatNPR(summary.failed_amount)],
  ];

  ctx.font = `400 ${10 * SCALE}px system-ui, sans-serif`;
  for (const [label, count, amount] of summaryRows) {
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(label, MARGIN, y);
    ctx.fillStyle = COLORS.text;
    ctx.font = `600 ${10 * SCALE}px system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(`${count} · ${amount}`, MARGIN + contentW, y);
    ctx.textAlign = "left";
    ctx.font = `400 ${10 * SCALE}px system-ui, sans-serif`;
    y += 18 * SCALE;
  }

  y += 12 * SCALE;
  ctx.strokeStyle = COLORS.line;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(MARGIN + contentW, y);
  ctx.stroke();
  y += 24 * SCALE;

  ctx.fillStyle = COLORS.text;
  ctx.font = `600 ${13 * SCALE}px system-ui, sans-serif`;
  ctx.fillText("By service", MARGIN, y);
  y += 20 * SCALE;

  ctx.font = `400 ${10 * SCALE}px system-ui, sans-serif`;
  for (const [key, stats] of Object.entries(report.by_service)) {
    const label = serviceLabels[key] ?? key;
    ctx.fillStyle = COLORS.text;
    ctx.font = `600 ${10 * SCALE}px system-ui, sans-serif`;
    ctx.fillText(label, MARGIN, y);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `400 ${9 * SCALE}px system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(
      `${stats.total_count} txns · ${formatNPR(stats.success_amount)} success`,
      MARGIN + contentW,
      y,
    );
    ctx.textAlign = "left";
    y += 16 * SCALE;
  }

  y += 12 * SCALE;
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 ${13 * SCALE}px system-ui, sans-serif`;
  ctx.fillText("Daily volume (success)", MARGIN, y);
  y += 20 * SCALE;

  ctx.font = `400 ${9 * SCALE}px system-ui, sans-serif`;
  for (const day of report.daily.slice(0, 12)) {
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(day.date, MARGIN, y);
    ctx.fillStyle = COLORS.brand;
    ctx.font = `600 ${9 * SCALE}px system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(formatNPR(String(day.total)), MARGIN + contentW, y);
    ctx.textAlign = "left";
    ctx.font = `400 ${9 * SCALE}px system-ui, sans-serif`;
    y += 14 * SCALE;
  }

  ctx.fillStyle = COLORS.muted;
  ctx.font = `400 ${8 * SCALE}px system-ui, sans-serif`;
  const footer = `Generated by ${brandName}`;
  wrapText(ctx, footer, contentW).forEach((line) => {
    ctx.fillText(line, MARGIN, PAGE_H - 32 * SCALE);
  });

  const jpeg = await canvasToJpegBytes(canvas);
  const pdfBytes = jpegToPdfBytes(jpeg, PAGE_W, PAGE_H);
  const safePeriod = (periodLabel || "report").replace(/[^\w.-]+/g, "-").slice(0, 40);
  await triggerDownload(pdfBytes, `mysewa-report-${safePeriod}.pdf`);
}
