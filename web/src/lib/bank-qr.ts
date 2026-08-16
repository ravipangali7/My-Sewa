import type { BankOption } from "./types";
import { matchBank, normalizeBankCode } from "./nepali-banks";

export type ParsedBankQr = {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amount: string;
  isMobile: boolean;
  /** True when the payload identifies a MySewa wallet (receive / load). */
  isMySewaWallet: boolean;
};

/** EMV merchant GUID encoded in personal MySewa receive-QR codes. */
export const MYSEWA_QR_GUID = "mysewa.com.np";

export type ParseBankQrResult =
  | { ok: true; data: ParsedBankQr }
  | { ok: false; reason: "empty" | "not_qr" | "not_bank" };

const NEPAL_SWIFT_RE = /^[A-Z]{4}NP[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const NEPALI_MOBILE_RE = /^(?:\+?977)?9[6-8]\d{8}$/;
const ACCOUNT_RE = /^[0-9][0-9\-]{7,21}$/;

const JSON_KEYS = {
  bankCode: ["bank_code", "bankcode", "bank", "bic", "swift", "swiftcode", "destination_bank"],
  bankName: ["bank_name", "bankname", "bank_title"],
  accountNumber: [
    "account_number",
    "accountnumber",
    "account_no",
    "accountno",
    "acc_no",
    "accno",
    "account",
    "destination_acc_no",
    "iban",
    "phone",
  ],
  accountName: [
    "account_name",
    "accountname",
    "account_holder",
    "accountholder",
    "name",
    "merchant_name",
    "merchantname",
    "destination_acc_name",
  ],
  amount: ["amount", "txn_amount", "txnamount", "am", "amt"],
} as const;

function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const lenRaw = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenRaw)) break;
    const len = Number(lenRaw);
    i += 4;
    if (len < 0 || i + len > payload.length) break;
    out[tag] = payload.slice(i, i + len);
    i += len;
  }
  return out;
}

function looksLikeEmv(raw: string): boolean {
  const idx = raw.indexOf("000201");
  return idx >= 0 && idx < 8;
}

function extractEmvPayload(raw: string): string {
  const idx = raw.indexOf("000201");
  return idx >= 0 ? raw.slice(idx) : raw;
}

function isSwift(value: string): boolean {
  return NEPAL_SWIFT_RE.test(normalizeBankCode(value) || value.toUpperCase());
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function last10Digits(value: string): string {
  return digitsOnly(value).slice(-10);
}

export function phonesMatch(a: string, b: string): boolean {
  const left = last10Digits(a);
  const right = last10Digits(b);
  return left.length === 10 && left === right;
}

function isMySewaBrand(value: string): boolean {
  return /my\s*sewa/i.test(value);
}

function isNepaliMobile(value: string): boolean {
  const digits = digitsOnly(value);
  return NEPALI_MOBILE_RE.test(digits) || NEPALI_MOBILE_RE.test(value.trim());
}

function isAccountNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!ACCOUNT_RE.test(trimmed)) return false;
  const digits = digitsOnly(trimmed);
  return digits.length >= 8 && digits.length <= 20;
}

function pickJsonValue(obj: Record<string, unknown>, keys: readonly string[]): string {
  const entries = Object.entries(obj);
  for (const key of keys) {
    for (const [k, v] of entries) {
      if (k.toLowerCase().replace(/[\s-]/g, "") === key.replace(/_/g, "")) {
        if (v == null) continue;
        const s = String(v).trim();
        if (s) return s;
      }
    }
  }
  return "";
}

function parseJsonPayload(raw: string): Partial<ParsedBankQr> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    return {
      bankCode: pickJsonValue(obj, JSON_KEYS.bankCode),
      bankName: pickJsonValue(obj, JSON_KEYS.bankName),
      accountNumber: pickJsonValue(obj, JSON_KEYS.accountNumber),
      accountName: pickJsonValue(obj, JSON_KEYS.accountName),
      amount: pickJsonValue(obj, JSON_KEYS.amount),
      isMobile: obj["is_mobile"] === true || obj["isMobile"] === true,
      isMySewaWallet:
        obj["is_mysewa"] === true ||
        obj["isMySewa"] === true ||
        isMySewaBrand(pickJsonValue(obj, JSON_KEYS.bankName)) ||
        isMySewaBrand(pickJsonValue(obj, JSON_KEYS.bankCode)),
    };
  } catch {
    return null;
  }
}

function parseQueryPayload(raw: string): Partial<ParsedBankQr> {
  const out: Partial<ParsedBankQr> = {};
  let query = raw.trim();
  try {
    if (/^https?:\/\//i.test(query) || query.includes("://")) {
      const url = new URL(query);
      query = url.search.startsWith("?") ? url.search.slice(1) : url.search;
      if (!query && url.hash.includes("=")) {
        query = url.hash.replace(/^#/, "").replace(/^[^?]*\?/, "");
      }
    }
  } catch {
    /* keep as-is */
  }
  const qIdx = query.indexOf("?");
  if (qIdx >= 0) query = query.slice(qIdx + 1);
  if (!query.includes("=")) return out;

  const params = new URLSearchParams(query);
  const asObj: Record<string, unknown> = {};
  params.forEach((value, key) => {
    asObj[key] = value;
  });
  out.bankCode = pickJsonValue(asObj, JSON_KEYS.bankCode);
  out.bankName = pickJsonValue(asObj, JSON_KEYS.bankName);
  out.accountNumber = pickJsonValue(asObj, JSON_KEYS.accountNumber);
  out.accountName = pickJsonValue(asObj, JSON_KEYS.accountName);
  out.amount = pickJsonValue(asObj, JSON_KEYS.amount);
  return out;
}

function parseDelimitedPayload(raw: string): Partial<ParsedBankQr> {
  const parts = raw
    .split(/[|;,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return {};
  const out: Partial<ParsedBankQr> = {};
  for (const part of parts) {
    if (!out.bankCode && (isSwift(part) || normalizeBankCode(part).length >= 4)) {
      if (isSwift(part) || /^[A-Z]{3,8}$/i.test(part)) {
        out.bankCode = part;
        continue;
      }
    }
    if (!out.accountNumber && (isAccountNumber(part) || isNepaliMobile(part))) {
      out.accountNumber = part;
      continue;
    }
    if (!out.accountName && /[A-Za-z\u0900-\u097F]/.test(part) && part.length >= 3) {
      out.accountName = part;
      continue;
    }
    if (!out.amount && /^\d+(?:\.\d{1,2})?$/.test(part) && Number(part) > 0) {
      out.amount = part;
    }
  }
  return out;
}

function parseEmvPayload(raw: string): Partial<ParsedBankQr> {
  const tlv = parseTlv(extractEmvPayload(raw));
  if (!tlv["00"]) return {};

  const out: Partial<ParsedBankQr> = {};
  const swifts: string[] = [];
  const accounts: string[] = [];
  const mobiles: string[] = [];

  const consider = (value: string, guid = "") => {
    const v = value.trim();
    if (!v) return;
    const lowerGuid = guid.toLowerCase();
    if (v.length <= 3 && /^\d+$/.test(v)) return;
    if (isSwift(v) || NEPAL_SWIFT_RE.test(v.toUpperCase())) {
      swifts.push(v);
      return;
    }
    if (isNepaliMobile(v)) {
      mobiles.push(digitsOnly(v).slice(-10));
      return;
    }
    if (isAccountNumber(v)) {
      accounts.push(digitsOnly(v) || v);
      return;
    }
    const normalized = normalizeBankCode(v);
    if (normalized.length >= 4 && /^[A-Z0-9]+$/.test(normalized) && !/nchl|fonepay|npay/i.test(v)) {
      if (!lowerGuid.includes("fonepay") && v.length <= 11) {
        swifts.push(v);
      }
    }
  };

  for (let tag = 26; tag <= 51; tag++) {
    const key = String(tag).padStart(2, "0");
    const nestedRaw = tlv[key];
    if (!nestedRaw) continue;
    const nested = parseTlv(nestedRaw);
    const guid = nested["00"] || "";
    if (isMySewaBrand(guid) || guid.toLowerCase().includes(MYSEWA_QR_GUID)) {
      out.isMySewaWallet = true;
    }
    for (const [sub, value] of Object.entries(nested)) {
      if (sub === "00") continue;
      consider(value, guid);
    }
    if (!nested["01"] && !nested["02"]) consider(nestedRaw, guid);
  }

  const additional = tlv["62"] ? parseTlv(tlv["62"]) : {};
  for (const value of Object.values(additional)) consider(value);

  if (tlv["59"]) out.accountName = tlv["59"].trim();
  if (tlv["54"] && /^\d+(?:\.\d{1,2})?$/.test(tlv["54"])) out.amount = tlv["54"];

  if (swifts[0]) out.bankCode = swifts[0];
  if (accounts[0]) {
    out.accountNumber = accounts[0];
  } else if (mobiles[0] && !swifts[0]) {
    out.accountNumber = mobiles[0];
    out.isMobile = true;
  } else if (mobiles[0] && !accounts[0]) {
    // Prefer the mobile as a last resort when a bank is present but no account.
    out.accountNumber = mobiles[0];
    out.isMobile = true;
  }

  return out;
}

function mergeParts(...parts: Array<Partial<ParsedBankQr> | null | undefined>): Partial<ParsedBankQr> {
  const out: Partial<ParsedBankQr> = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.bankCode && !out.bankCode) out.bankCode = part.bankCode;
    if (part.bankName && !out.bankName) out.bankName = part.bankName;
    if (part.accountNumber && !out.accountNumber) out.accountNumber = part.accountNumber;
    if (part.accountName && !out.accountName) out.accountName = part.accountName;
    if (part.amount && !out.amount) out.amount = part.amount;
    if (part.isMobile) out.isMobile = true;
    if (part.isMySewaWallet) out.isMySewaWallet = true;
  }
  return out;
}

function finalize(
  partial: Partial<ParsedBankQr>,
  banks: BankOption[],
): ParseBankQrResult {
  let accountNumber = String(partial.accountNumber || "").trim();
  const accountName = String(partial.accountName || "").trim();
  const amountRaw = String(partial.amount || "").trim().replace(/,/g, "");
  const amount = /^\d+(?:\.\d{1,2})?$/.test(amountRaw) && Number(amountRaw) > 0 ? amountRaw : "";

  const isMySewaWallet =
    Boolean(partial.isMySewaWallet) ||
    isMySewaBrand(String(partial.bankName || "")) ||
    isMySewaBrand(String(partial.bankCode || ""));

  let isMobile = Boolean(partial.isMobile) || isMySewaWallet;
  if (!isMobile && isNepaliMobile(accountNumber) && !partial.bankCode) {
    isMobile = true;
  }
  if (isMobile) {
    const digits = digitsOnly(accountNumber).slice(-10);
    if (digits.length === 10) accountNumber = digits;
  } else {
    accountNumber = accountNumber.replace(/[\s-]/g, "");
  }

  const matched = isMySewaWallet
    ? undefined
    : matchBank(banks, partial.bankCode || "") || matchBank(banks, partial.bankName || "");

  if (!accountNumber) {
    return { ok: false, reason: "not_bank" };
  }
  if (!isMobile && accountNumber.length < 5) {
    return { ok: false, reason: "not_bank" };
  }
  if (isMobile && accountNumber.length < 10) {
    return { ok: false, reason: "not_bank" };
  }

  return {
    ok: true,
    data: {
      bankCode: isMySewaWallet ? "" : matched?.bank_code || normalizeBankCode(partial.bankCode || ""),
      bankName: isMySewaWallet
        ? "MySewa"
        : matched?.bank_name || String(partial.bankName || "").trim(),
      accountNumber,
      accountName,
      amount,
      isMobile,
      isMySewaWallet,
    },
  };
}

/** Parse a NepalPay / Fonepay / bank-account QR payload into transfer fields. */
export function parseBankQr(raw: string, banks: BankOption[] = []): ParseBankQrResult {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, reason: "empty" };

  const emv = looksLikeEmv(text) ? parseEmvPayload(text) : {};
  const json = parseJsonPayload(text);
  const query = parseQueryPayload(text);
  const delimited = parseDelimitedPayload(text);

  const merged = mergeParts(json, emv, query, delimited);
  if (merged.accountNumber || merged.bankCode) {
    return finalize(merged, banks);
  }

  // Bare account number QR (some banks encode only the number).
  if (isAccountNumber(text) || isNepaliMobile(text)) {
    return finalize(
      {
        accountNumber: text,
        isMobile: isNepaliMobile(text) && !isAccountNumber(text),
      },
      banks,
    );
  }

  return { ok: false, reason: "not_qr" };
}

function emvTlv(tag: string, value: string): string {
  const payload = String(value || "");
  return `${tag}${String(payload.length).padStart(2, "0")}${payload}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) used by EMVCo QR tag 63. */
export function crc16Ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function emvMerchantName(name: string): string {
  const trimmed = String(name || "").trim();
  const ascii = trimmed.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  const usable = ascii || "Mysewa";
  return usable.slice(0, 25);
}

/**
 * Personal receive-QR payload. Encoded as an EMVCo Nepal (NPR) merchant QR so
 * MySewa and other payment apps that read account/mobile TLV can send value
 * into this user's MySewa wallet (identified by their mobile number).
 */
export function buildMySewaAccountQr(details: {
  accountName: string;
  accountNumber: string;
}): string {
  const phone = last10Digits(details.accountNumber) || String(details.accountNumber || "").trim();
  const merchant = emvMerchantName(details.accountName);
  const mai = emvTlv("00", MYSEWA_QR_GUID) + emvTlv("01", phone);
  const additional = emvTlv("01", phone);
  const body =
    emvTlv("00", "01") +
    emvTlv("01", "11") +
    emvTlv("26", mai) +
    emvTlv("52", "0000") +
    emvTlv("53", "524") +
    emvTlv("58", "NP") +
    emvTlv("59", merchant) +
    emvTlv("60", "KATHMANDU") +
    emvTlv("62", additional) +
    "6304";
  return body + crc16Ccitt(body);
}
