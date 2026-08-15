import type { BankOption } from "./types";

/**
 * Fallback bank list when HimalPay BANK_TRANSFER_LIST is unavailable.
 *
 * Authoritative support comes from HimalPay Step 1 (`BANK_TRANSFER_LIST`) —
 * see himalpay.md. Codes must be SWIFT/BIC style (e.g. CTZNNPKA); short
 * tickers like "CTZN" are rejected by HimalPay at payment time.
 *
 * Keep in sync with `server/core/services/nepali_banks.py`.
 */
export const NEPALI_BANKS: BankOption[] = [
  { bank_code: "ADBLNPKA", bank_name: "Agricultural Development Bank" },
  { bank_code: "BOKLNPKA", bank_name: "Bank of Kathmandu" },
  { bank_code: "CCBNNPKA", bank_name: "Century Commercial Bank" },
  { bank_code: "CTZNNPKA", bank_name: "Citizens Bank International" },
  { bank_code: "CIVLNPKA", bank_name: "Civil Bank" },
  { bank_code: "EVBLNPKA", bank_name: "Everest Bank" },
  { bank_code: "GLBBNPKA", bank_name: "Global IME Bank" },
  { bank_code: "HIMANPKA", bank_name: "Himalayan Bank" },
  { bank_code: "KMBLNPKA", bank_name: "Kumari Bank" },
  { bank_code: "LXBLNPKA", bank_name: "Laxmi Sunrise Bank" },
  { bank_code: "MBLNNPKA", bank_name: "Machhapuchchhre Bank" },
  { bank_code: "NARBNPKA", bank_name: "Nabil Bank" },
  { bank_code: "NEBLNPKA", bank_name: "Nepal Bank Limited" },
  { bank_code: "NIBLNPKA", bank_name: "Nepal Investment Mega Bank" },
  { bank_code: "NSBINPKA", bank_name: "Nepal SBI Bank" },
  { bank_code: "NICENPKA", bank_name: "NIC Asia Bank" },
  { bank_code: "NMBBNPKA", bank_name: "NMB Bank" },
  { bank_code: "PRVUNPKA", bank_name: "Prabhu Bank" },
  { bank_code: "PCBLNPKA", bank_name: "Prime Commercial Bank" },
  { bank_code: "RBBENPKA", bank_name: "Rastriya Banijya Bank" },
  { bank_code: "SNMANPKA", bank_name: "Sanima Bank" },
  { bank_code: "SIDDNPKA", bank_name: "Siddhartha Bank" },
  { bank_code: "SCBLNPKA", bank_name: "Standard Chartered Bank Nepal" },
];

/**
 * Prefer the live HimalPay bank list (SWIFT codes). Never merge short
 * fallback tickers into a non-empty provider list — that caused payments
 * to be sent with codes like "CTZN" which HimalPay accepts then fails.
 */
export function mergeBankLists(provider: BankOption[]): BankOption[] {
  const source = provider.length > 0 ? provider : NEPALI_BANKS;

  const byCode = new Map<string, BankOption>();
  for (const b of source) {
    if (!b?.bank_code) continue;
    const code = String(b.bank_code).trim().toUpperCase();
    if (!code) continue;
    byCode.set(code, {
      bank_code: code,
      bank_name: String(b.bank_name || code),
    });
  }
  return [...byCode.values()].sort((a, b) =>
    a.bank_name.localeCompare(b.bank_name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Short / alternate codes seen in bank QRs and older clients → HimalPay SWIFT.
 * Keep in sync with `server/core/services/nepali_banks.py`.
 */
export const LEGACY_BANK_CODE_MAP: Record<string, string> = {
  NABIL: "NARBNPKA",
  NARBNPKA: "NARBNPKA",
  NBBL: "NARBNPKA",
  NBBLNPKA: "NARBNPKA",
  NIBL: "NIBLNPKA",
  NIBLNPKA: "NIBLNPKA",
  NIBLNPKT: "NIBLNPKA",
  NIMB: "NIBLNPKA",
  SCB: "SCBLNPKA",
  SCBLNPKA: "SCBLNPKA",
  HBL: "HIMANPKA",
  HIMANPKA: "HIMANPKA",
  EBL: "EVBLNPKA",
  EVBLNPKA: "EVBLNPKA",
  NMB: "NMBBNPKA",
  NMBBNPKA: "NMBBNPKA",
  PCBL: "PCBLNPKA",
  PCBLNPKA: "PCBLNPKA",
  SANIMA: "SNMANPKA",
  SNMANPKA: "SNMANPKA",
  SANINPKA: "SNMANPKA",
  SBI: "NSBINPKA",
  NSBINPKA: "NSBINPKA",
  SBINPKA: "NSBINPKA",
  MBL: "MBLNNPKA",
  MBLNNPKA: "MBLNNPKA",
  KBL: "KMBLNPKA",
  KMBLNPKA: "KMBLNPKA",
  LBL: "LXBLNPKA",
  LXBLNPKA: "LXBLNPKA",
  CBL: "CIVLNPKA",
  CIVLNPKA: "CIVLNPKA",
  CTZN: "CTZNNPKA",
  CTZNNPKA: "CTZNNPKA",
  NICA: "NICENPKA",
  NICENPKA: "NICENPKA",
  GBIME: "GLBBNPKA",
  GLBBNPKA: "GLBBNPKA",
  PRVU: "PRVUNPKA",
  PRVUNPKA: "PRVUNPKA",
  PRBL: "PRVUNPKA",
  PRBLNPKA: "PRVUNPKA",
  ADBL: "ADBLNPKA",
  ADBLNPKA: "ADBLNPKA",
  RBB: "RBBENPKA",
  RBBENPKA: "RBBENPKA",
  NBL: "NEBLNPKA",
  NEBLNPKA: "NEBLNPKA",
  SBL: "SIDDNPKA",
  SIDDNPKA: "SIDDNPKA",
  BOK: "BOKLNPKA",
  BOKLNPKA: "BOKLNPKA",
  CCBL: "CCBNNPKA",
  CCBNNPKA: "CCBNNPKA",
};

const NEPAL_SWIFT_RE = /^[A-Z]{4}NP[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

/** Normalize a QR / ticker / 11-char BIC into an 8-character HimalPay SWIFT code. */
export function normalizeBankCode(raw: string): string {
  const trimmed = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!trimmed) return "";
  const mapped = LEGACY_BANK_CODE_MAP[trimmed];
  if (mapped) return mapped;
  if (trimmed.length === 11 && NEPAL_SWIFT_RE.test(trimmed)) {
    const eight = trimmed.slice(0, 8);
    return LEGACY_BANK_CODE_MAP[eight] || eight;
  }
  if (trimmed.length === 8 && NEPAL_SWIFT_RE.test(trimmed)) {
    return LEGACY_BANK_CODE_MAP[trimmed] || trimmed;
  }
  return LEGACY_BANK_CODE_MAP[trimmed] || trimmed;
}

export function matchBank(
  banks: BankOption[],
  codeOrName: string,
): BankOption | undefined {
  const raw = String(codeOrName || "").trim();
  if (!raw) return undefined;
  const normalized = normalizeBankCode(raw);
  const upper = raw.toUpperCase();

  const byCode = banks.find(
    (b) =>
      b.bank_code === normalized ||
      b.bank_code === upper ||
      b.bank_code.startsWith(normalized) ||
      normalized.startsWith(b.bank_code),
  );
  if (byCode) return byCode;

  const needle = raw.toLowerCase();
  return banks.find((b) => {
    const name = b.bank_name.toLowerCase();
    return name === needle || name.includes(needle) || needle.includes(name);
  });
}
