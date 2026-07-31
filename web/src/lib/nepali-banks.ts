import type { BankOption } from "./types";

/** Common Nepali commercial banks (fallback when provider list is empty). */
export const NEPALI_BANKS: BankOption[] = [
  { bank_code: "NABIL", bank_name: "Nabil Bank" },
  { bank_code: "NIBL", bank_name: "Nepal Investment Mega Bank" },
  { bank_code: "SCB", bank_name: "Standard Chartered Bank Nepal" },
  { bank_code: "HBL", bank_name: "Himalayan Bank" },
  { bank_code: "EBL", bank_name: "Everest Bank" },
  { bank_code: "NMB", bank_name: "NMB Bank" },
  { bank_code: "PCBL", bank_name: "Prime Commercial Bank" },
  { bank_code: "SANIMA", bank_name: "Sanima Bank" },
  { bank_code: "SBI", bank_name: "Nepal SBI Bank" },
  { bank_code: "MBL", bank_name: "Machhapuchchhre Bank" },
  { bank_code: "KBL", bank_name: "Kumari Bank" },
  { bank_code: "LBL", bank_name: "Laxmi Sunrise Bank" },
  { bank_code: "CBL", bank_name: "Civil Bank" },
  { bank_code: "CTZN", bank_name: "Citizens Bank International" },
  { bank_code: "NICA", bank_name: "NIC Asia Bank" },
  { bank_code: "GBIME", bank_name: "Global IME Bank" },
  { bank_code: "PRVU", bank_name: "Prabhu Bank" },
  { bank_code: "SRBL", bank_name: "Sunrise Bank" },
  { bank_code: "ADBL", bank_name: "Agricultural Development Bank" },
  { bank_code: "RBB", bank_name: "Rastriya Banijya Bank" },
  { bank_code: "NBL", bank_name: "Nepal Bank Limited" },
  { bank_code: "SBL", bank_name: "Siddhartha Bank" },
  { bank_code: "JBNL", bank_name: "Janata Bank Nepal" },
  { bank_code: "BOK", bank_name: "Bank of Kathmandu" },
  { bank_code: "CCBL", bank_name: "Century Commercial Bank" },
  { bank_code: "NBB", bank_name: "Nepal Bangladesh Bank" },
  { bank_code: "MNBBL", bank_name: "Muktinath Bikas Bank" },
  { bank_code: "GBBL", bank_name: "Garima Bikas Bank" },
  { bank_code: "JBBL", bank_name: "Jyoti Bikas Bank" },
  { bank_code: "SHINE", bank_name: "Shine Resunga Development Bank" },
  { bank_code: "KSBBL", bank_name: "Kamana Sewa Bikas Bank" },
  { bank_code: "CORBL", bank_name: "Corporate Development Bank" },
  { bank_code: "SADANIRA", bank_name: "Sadanira Development Bank" },
  { bank_code: "NACDB", bank_name: "NAC Development Bank" },
];

export function mergeBankLists(provider: BankOption[]): BankOption[] {
  const byCode = new Map<string, BankOption>();
  for (const b of NEPALI_BANKS) {
    byCode.set(b.bank_code.toUpperCase(), b);
  }
  for (const b of provider) {
    if (!b?.bank_code) continue;
    byCode.set(String(b.bank_code).toUpperCase(), {
      bank_code: String(b.bank_code),
      bank_name: String(b.bank_name || b.bank_code),
    });
  }
  return [...byCode.values()].sort((a, b) =>
    a.bank_name.localeCompare(b.bank_name, undefined, { sensitivity: "base" }),
  );
}
