/**
 * MySewa payment QR encode/decode + best-effort Nepal bank QR (EMVCo) parsing.
 */

export type QrTransferPrefill = {
  method: "bank" | "phone";
  bank?: string;
  accNo?: string;
  accName?: string;
  phone?: string;
  amount?: string;
};

const MYSEWA_PREFIX = "MYSEWA1";

function pick(value: string | undefined | null): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function buildMySewaPaymentPayload(phone: string, name: string): string {
  const cleanPhone = phone.replace(/\D/g, "").replace(/^977/, "");
  const cleanName = name.trim().replace(/\|/g, " ").slice(0, 80);
  return `${MYSEWA_PREFIX}|${cleanPhone}|${cleanName}`;
}

function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(len) || len < 0 || i + 4 + len > payload.length) break;
    out[tag] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

function extractPhone(text: string): string | undefined {
  const digits = text.replace(/\D/g, "");
  const local = digits.startsWith("977") ? digits.slice(3) : digits;
  const match = local.match(/9[78]\d{8}/);
  return match?.[0];
}

function extractAccountCandidate(text: string): string | undefined {
  const matches = text.match(/\d{8,20}/g) || [];
  const phone = extractPhone(text);
  return matches.find((m) => m !== phone && !(phone && m.includes(phone)));
}

function phonePrefill(
  phone: string,
  extras: Omit<QrTransferPrefill, "method" | "phone"> = {},
): QrTransferPrefill {
  const result: QrTransferPrefill = { method: "phone", phone };
  if (extras.accName) result.accName = extras.accName;
  if (extras.amount) result.amount = extras.amount;
  if (extras.bank) result.bank = extras.bank;
  if (extras.accNo) result.accNo = extras.accNo;
  return result;
}

function bankPrefill(
  accNo: string,
  extras: Omit<QrTransferPrefill, "method" | "accNo"> = {},
): QrTransferPrefill {
  const result: QrTransferPrefill = { method: "bank", accNo };
  if (extras.accName) result.accName = extras.accName;
  if (extras.amount) result.amount = extras.amount;
  if (extras.bank) result.bank = extras.bank;
  if (extras.phone) result.phone = extras.phone;
  return result;
}

function parseMySewa(raw: string): QrTransferPrefill | null {
  const trimmed = raw.trim();

  if (trimmed.startsWith(`${MYSEWA_PREFIX}|`)) {
    const parts = trimmed.split("|");
    const phone = (parts[1] || "").replace(/\D/g, "");
    const name = pick(parts[2]);
    if (phone.length < 10) return null;
    return phonePrefill(phone, name ? { accName: name } : {});
  }

  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    if (json["app"] === "mysewa" || json["type"] === "mysewa") {
      const phone = String(json["phone"] || "").replace(/\D/g, "");
      if (phone.length < 10) return null;
      const extras: Omit<QrTransferPrefill, "method" | "phone"> = {};
      const name = pick(String(json["name"] || json["accName"] || ""));
      if (name) extras.accName = name;
      if (json["amount"] != null) extras.amount = String(json["amount"]);
      return phonePrefill(phone, extras);
    }
  } catch {
    // not JSON
  }

  try {
    const url = new URL(trimmed);
    if (
      url.protocol === "mysewa:" ||
      url.hostname.includes("mysewa") ||
      url.pathname.includes("pay")
    ) {
      const phone = (url.searchParams.get("phone") || "").replace(/\D/g, "");
      if (phone.length >= 10) {
        const extras: Omit<QrTransferPrefill, "method" | "phone"> = {};
        const name = pick(
          url.searchParams.get("name") || url.searchParams.get("accName"),
        );
        const amount = pick(url.searchParams.get("amount"));
        const bank = pick(url.searchParams.get("bank"));
        const accNo = pick(url.searchParams.get("accNo"));
        if (name) extras.accName = name;
        if (amount) extras.amount = amount;
        if (bank) extras.bank = bank;
        if (accNo) extras.accNo = accNo;
        return phonePrefill(phone, extras);
      }
    }
  } catch {
    // not a URL
  }

  return null;
}

function parseEmvCo(raw: string): QrTransferPrefill | null {
  if (!/^\d{2}\d{2}/.test(raw) || raw.length < 20) return null;
  const root = parseTlv(raw);
  if (!root["00"] && !root["59"] && !root["26"]) return null;

  const name = pick(root["59"]);
  const amount = pick(root["54"]);

  let bank: string | undefined;
  let accNo: string | undefined;
  let phone: string | undefined;

  for (const tag of Object.keys(root)) {
    if (tag < "26" || tag > "51") continue;
    const segment = root[tag] ?? "";
    const nested = parseTlv(segment);
    const blob = Object.values(nested).join(" ");
    phone = phone || extractPhone(blob) || extractPhone(segment);
    accNo = accNo || extractAccountCandidate(blob) || extractAccountCandidate(segment);

    for (const [k, v] of Object.entries(nested)) {
      const upper = v.toUpperCase();
      if (!bank && (k === "01" || k === "02") && /^[A-Z0-9]{3,11}$/.test(upper) && !/^\d+$/.test(upper)) {
        bank = upper;
      }
      if (!accNo && /^\d{8,20}$/.test(v)) accNo = v;
      if (!phone) phone = extractPhone(v);
    }
  }

  phone = phone || extractPhone(raw);
  accNo = accNo || extractAccountCandidate(raw);

  const extras: Omit<QrTransferPrefill, "method" | "phone" | "accNo"> = {};
  if (name) extras.accName = name;
  if (amount) extras.amount = amount;
  if (bank) extras.bank = bank;

  if (phone && (!accNo || accNo === phone)) {
    return phonePrefill(phone, extras);
  }

  if (accNo) {
    return bankPrefill(accNo, extras);
  }

  if (phone) {
    return phonePrefill(phone, extras);
  }

  return null;
}

/** Parse any scanned QR payload into transfer prefill fields. */
export function parsePaymentQr(raw: string): QrTransferPrefill | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const mysewa = parseMySewa(trimmed);
  if (mysewa) return mysewa;

  const emv = parseEmvCo(trimmed);
  if (emv) return emv;

  const phone = extractPhone(trimmed);
  if (phone && trimmed.replace(/\D/g, "").length <= 15) {
    return phonePrefill(phone);
  }

  if (trimmed.includes("=") && (trimmed.includes("&") || trimmed.includes("\n"))) {
    const params = new URLSearchParams(trimmed.replace(/\n/g, "&"));
    const p = (params.get("phone") || "").replace(/\D/g, "");
    const accNo = pick(
      params.get("accNo") || params.get("account") || params.get("account_number"),
    );
    const accName = pick(
      params.get("name") || params.get("accName") || params.get("account_name"),
    );
    const bank = pick(params.get("bank") || params.get("bank_code"));
    const amount = pick(params.get("amount"));
    const extras: Omit<QrTransferPrefill, "method" | "phone" | "accNo"> = {};
    if (accName) extras.accName = accName;
    if (bank) extras.bank = bank;
    if (amount) extras.amount = amount;

    if (p.length >= 10) return phonePrefill(p, extras);
    if (accNo) return bankPrefill(accNo, extras);
  }

  return null;
}

export function transferSearchFromPrefill(prefill: QrTransferPrefill) {
  return {
    method: prefill.method as "bank" | "phone",
    bank: prefill.bank,
    accNo: prefill.accNo,
    accName: prefill.accName,
    phone: prefill.phone,
    amount: prefill.amount,
    fromQr: "1" as const,
  };
}
