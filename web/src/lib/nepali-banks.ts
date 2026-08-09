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
