import type { HimalPayResellerBalance } from "@/lib/types";

function asAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Map HimalPay reseller-balance fields (docs §7) into rupee amounts. */
export function resolveHimalPayBalance(raw: HimalPayResellerBalance | null | undefined) {
  if (!raw) {
    return { main: null as number | null, bonus: null as number | null, total: null as number | null };
  }
  const mainFromRupees = asAmount(raw.balance_in_rupees);
  const bonusFromRupees = asAmount(raw.bonus_balance_in_rupees);
  const totalFromRupees = asAmount(raw.total_balance_in_rupees);
  const mainFromPaisa = asAmount(raw.balance);
  const bonusFromPaisa = asAmount(raw.bonus_balance);

  const main =
    mainFromRupees ?? (mainFromPaisa != null ? mainFromPaisa / 100 : null);
  const bonus =
    bonusFromRupees ?? (bonusFromPaisa != null ? bonusFromPaisa / 100 : null);
  const total =
    totalFromRupees ??
    (main != null || bonus != null ? (main ?? 0) + (bonus ?? 0) : null);

  return { main, bonus, total };
}

export function himalPayBalanceSourceLabel(source: string) {
  switch (source) {
    case "portal-wallet":
      return "Live via portal wallet";
    case "statement-derived":
      return "Live from latest HimalPay statement";
    case "reseller-balance":
      return "Live from HimalPay reseller balance";
    case "bypass":
      return "Bypass mode";
    default:
      return "Live HimalPay balance";
  }
}
