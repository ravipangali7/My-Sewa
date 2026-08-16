import { COLORS } from "@/constants/colors";

export type MyQrCardDetails = {
  qrSrc: string;
  logoUrl: string;
  name: string;
  username?: string;
  phone: string;
  hint: string;
};

/** User fields needed to render / encode a personal Mysewa payment QR. */
export type MySewaQrUser = {
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  phone?: string | null;
};

export type MySewaQrIdentity = {
  legalName: string;
  nickname: string;
  displayName: string;
  username: string;
  phone: string;
  /** Account-holder name encoded in the EMV payload (legal name preferred). */
  payloadName: string;
};

/** Shared identity for the in-app QR and the Super Admin copy of that QR. */
export function mySewaQrIdentity(
  user: MySewaQrUser | null | undefined,
  fallbackName = "",
): MySewaQrIdentity {
  const legalName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  const nickname = String(user?.nickname || "").trim();
  const phone = String(user?.phone || "").trim();
  const displayName = nickname || legalName || phone || fallbackName;
  const username = nickname && legalName && nickname !== legalName ? nickname : "";
  const payloadName = legalName || nickname || phone || "Mysewa";
  return { legalName, nickname, displayName, username, phone, payloadName };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const isData = src.startsWith("data:") || src.startsWith("blob:");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const isRemote =
      !isData && /^https?:\/\//i.test(src) && origin.length > 0 && !src.startsWith(origin);
    // Remote logos need CORS so the canvas stays exportable. Same-origin / data URLs
    // must not set crossOrigin — that can block decoding in WebView.
    if (isRemote) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

async function loadLogo(src: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(src);
  } catch {
    return loadImage("/logo.png");
  }
}

function drawCircleImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  size: number,
) {
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, size, size);
  ctx.restore();
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let binary = "";
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]!);
    parts.push(binary);
  }
  return btoa(parts.join(""));
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function dataUrlToBase64(dataUrl: string): string {
  return bytesToBase64(dataUrlToBytes(dataUrl));
}

/**
 * Rasterize the on-screen My QR preview into a PNG (logo, name, username, phone, QR).
 */
export async function renderMyQrCardPng(details: MyQrCardDetails): Promise<string> {
  const qrImg = await loadImage(details.qrSrc);
  const logoImg = await loadLogo(details.logoUrl || "/logo.png");

  const W = 1080;
  const padX = 88;
  const padTop = 72;
  const qrSize = 640;
  const logoSize = 72;
  const gapQr = 36;
  const gapLogo = 28;
  const gapName = 18;
  const gapPhone = 10;
  const gapHint = 28;
  const padBottom = 72;

  const username = (details.username || "").trim();
  const showUser = Boolean(username && username !== details.name);

  const nameSize = 44;
  const userSize = 30;
  const phoneSize = 32;
  const hintSize = 26;

  const brandRow = Math.max(logoSize, 48);
  let yCursor = padTop + qrSize + gapQr + brandRow + gapLogo + nameSize;
  if (showUser) yCursor += gapName + userSize;
  yCursor += gapPhone + phoneSize + gapHint + hintSize + padBottom;
  const H = yCursor;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(0, 0, W, H);

  const qrX = (W - qrSize) / 2;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(qrX, padTop, qrSize, qrSize);
  ctx.drawImage(qrImg, qrX, padTop, qrSize, qrSize);

  let y = padTop + qrSize + gapQr;
  const brandCenterY = y + brandRow / 2;
  ctx.font = `700 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "left";
  const myW = ctx.measureText("My").width;
  const sewaW = ctx.measureText("sewa").width;
  const brandGap = 16;
  const brandW = logoSize + brandGap + myW + sewaW;
  let bx = (W - brandW) / 2;
  drawCircleImage(ctx, logoImg, bx + logoSize / 2, brandCenterY, logoSize);
  bx += logoSize + brandGap;
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.ocean;
  ctx.fillText("My", bx, brandCenterY);
  ctx.fillStyle = COLORS.brand;
  ctx.fillText("sewa", bx + myW, brandCenterY);

  y += brandRow + gapLogo;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.label;
  ctx.font = `600 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(details.name, W / 2, y, W - padX * 2);

  y += nameSize;
  if (showUser) {
    y += gapName;
    ctx.fillStyle = COLORS.secondary;
    ctx.font = `500 ${userSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(username, W / 2, y, W - padX * 2);
    y += userSize;
  }

  y += gapPhone;
  ctx.fillStyle = COLORS.secondary;
  ctx.font = `500 ${phoneSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(details.phone, W / 2, y, W - padX * 2);

  y += phoneSize + gapHint;
  ctx.fillStyle = "#A1A1AA";
  ctx.font = `400 ${hintSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(details.hint, W / 2, y, W - padX * 2);

  return canvas.toDataURL("image/png");
}
