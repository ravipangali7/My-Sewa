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

export type ChargeType = "flat" | "percent";

export type ServiceChargeValue = {
  amount: string;
  charge_type: ChargeType;
};

export function emptyServiceAmounts(): Record<string, string> {
  return Object.fromEntries(SERVICE_CHARGE_OPTIONS.map((s) => [s.id, ""]));
}

export function emptyServiceChargeValues(): Record<string, ServiceChargeValue> {
  return Object.fromEntries(
    SERVICE_CHARGE_OPTIONS.map((s) => [s.id, { amount: "", charge_type: "flat" as const }]),
  );
}

function asChargeType(value: unknown): ChargeType {
  return value === "percent" ? "percent" : "flat";
}

export function valuesFromCharges(
  charges?:
    | Record<string, string | ServiceChargeValue | undefined>
    | Array<{
        txn_type: string;
        amount?: string;
        charge_type?: ChargeType;
      }>,
): Record<string, ServiceChargeValue> {
  const next = emptyServiceChargeValues();
  if (!charges) return next;
  if (Array.isArray(charges)) {
    for (const row of charges) {
      if (!(row.txn_type in next)) continue;
      next[row.txn_type] = {
        amount: row.amount ?? "",
        charge_type: asChargeType(row.charge_type),
      };
    }
    return next;
  }
  for (const [txnType, raw] of Object.entries(charges)) {
    if (!(txnType in next) || raw == null) continue;
    if (typeof raw === "string") {
      next[txnType] = { amount: raw, charge_type: "flat" };
      continue;
    }
    next[txnType] = {
      amount: raw.amount ?? "",
      charge_type: asChargeType(raw.charge_type),
    };
  }
  return next;
}

/** @deprecated Use valuesFromCharges — kept so older call sites still compile. */
export function amountsFromCharges(
  charges?: Record<string, string> | Array<{ txn_type: string; amount?: string }>,
): Record<string, string> {
  const values = valuesFromCharges(charges);
  return Object.fromEntries(
    SERVICE_CHARGE_OPTIONS.map((s) => [s.id, values[s.id]?.amount ?? ""]),
  );
}

export function payloadFromChargeValues(
  values: Record<string, ServiceChargeValue>,
  { onlyFilled = false }: { onlyFilled?: boolean } = {},
): Array<{ txn_type: string; amount: string; charge_type: ChargeType }> {
  return SERVICE_CHARGE_OPTIONS.filter((service) => {
    if (!onlyFilled) return true;
    return (values[service.id]?.amount ?? "").trim() !== "";
  }).map((service) => ({
    txn_type: service.id,
    amount: values[service.id]?.amount ?? "",
    charge_type: values[service.id]?.charge_type ?? "flat",
  }));
}
