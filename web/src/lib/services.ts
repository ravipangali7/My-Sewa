/** Services that can have independent Commission Setup charges. */
export const SERVICE_CHARGE_OPTIONS = [
  { id: "topup", label: "Mobile top-up" },
  { id: "data_pack", label: "Data pack" },
  { id: "internet", label: "Internet / WiFi" },
  { id: "water", label: "Water" },
  { id: "electricity", label: "Electricity" },
  { id: "community_electricity", label: "Community electricity" },
  { id: "bank_transfer", label: "Fund transfer" },
  { id: "remittance", label: "Remittance" },
  { id: "wallet_transfer", label: "Wallet transfer" },
] as const;

export type ServiceChargeTxnType = (typeof SERVICE_CHARGE_OPTIONS)[number]["id"];

export function emptyServiceAmounts(): Record<string, string> {
  return Object.fromEntries(SERVICE_CHARGE_OPTIONS.map((s) => [s.id, ""]));
}

export function amountsFromCharges(
  charges?: Record<string, string> | Array<{ txn_type: string; amount?: string }>,
): Record<string, string> {
  const next = emptyServiceAmounts();
  if (!charges) return next;
  if (Array.isArray(charges)) {
    for (const row of charges) {
      if (row.txn_type in next) next[row.txn_type] = row.amount ?? "";
    }
    return next;
  }
  for (const [txnType, amount] of Object.entries(charges)) {
    if (txnType in next) next[txnType] = amount ?? "";
  }
  return next;
}
