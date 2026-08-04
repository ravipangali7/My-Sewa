import type { DataPackOption } from "@/lib/types";

export type PackCategory = "ALL" | "DATA" | "VOICE" | "COMBO" | "ROAMING" | "POPULAR";

export type DataPackOperator = "NTC" | "NCELL";

const NTC_CATEGORIES: PackCategory[] = ["ALL", "POPULAR", "COMBO", "DATA", "VOICE"];
const NCELL_CATEGORIES: PackCategory[] = ["ALL", "DATA", "VOICE", "COMBO", "ROAMING"];

export function getCategoriesForOperator(operator: DataPackOperator): PackCategory[] {
  return operator === "NTC" ? NTC_CATEGORIES : NCELL_CATEGORIES;
}

export function inferPackCategories(name: string): PackCategory[] {
  const lower = name.toLowerCase();
  const categories = new Set<PackCategory>();

  if (lower.includes("roam")) categories.add("ROAMING");
  if (
    lower.includes("combo") ||
    (/(gb|mb|data)/.test(lower) &&
      /(call|talk|min|voice|sms|unlimited all nepal)/.test(lower))
  ) {
    categories.add("COMBO");
  }
  if (/(gb|mb|\bdata\b)/.test(lower)) categories.add("DATA");
  if (/(call|talk|min|voice|sms|unlimited all nepal)/.test(lower)) categories.add("VOICE");
  if (lower.includes("popular") || lower.includes("prepaid combo")) categories.add("POPULAR");

  if (!categories.size) categories.add("DATA");
  return [...categories];
}

export function matchesCategory(pkg: DataPackOption, category: PackCategory): boolean {
  if (category === "ALL") return true;
  return inferPackCategories(pkg.name).includes(category);
}

export function extractValidityLabel(
  name: string,
  validity?: string | number | null,
): string {
  if (validity != null && String(validity).trim()) return String(validity).trim();
  const match = name.match(
    /(\d+\s*(?:days?|day|hours?|hrs?|hr|minutes?|mins?|min|months?|month))/i,
  );
  return match ? match[1].replace(/\bday\b/i, "Days").replace(/\bhr\b/i, "Hour") : "";
}

export function buildPackDescription(pkg: DataPackOption): string {
  if (pkg.description?.trim()) return pkg.description.trim();

  const volume = pkg.volume?.trim();
  const validity = extractValidityLabel(pkg.name, pkg.validity);

  if (volume && validity) return `Enjoy ${volume} for ${validity}.`;
  if (volume) return `Enjoy ${volume}.`;
  if (validity) return `Valid for ${validity}.`;

  const withoutPrice = nameWithoutTrailingPrice(pkg.name);
  if (withoutPrice && withoutPrice !== pkg.name) return withoutPrice;

  return pkg.name;
}

function nameWithoutTrailingPrice(name: string): string {
  return name.replace(/\s*@\s*\d+(?:\.\d+)?\s*$/, "").trim();
}

export function operatorDisplayName(operator: DataPackOperator): string {
  return operator === "NTC" ? "Ntc" : "Ncell";
}

export function operatorTheme(operator: DataPackOperator) {
  if (operator === "NTC") {
    return {
      header: "bg-[#0A7A4B]",
      buy: "bg-[#0A7A4B] hover:bg-[#065F3A]",
      viewMore: "bg-[#E8F6EF] text-[#065F3A] hover:bg-[#d4ede0]",
      badgeBg: "bg-white border border-[#C6E8D8]",
      badgeAccent: "text-[#0A7A4B]",
      tabActive: "bg-[#0A7A4B] text-white",
    };
  }
  return {
    header: "bg-[#5C2483]",
    buy: "bg-[#E91E8C] hover:bg-[#C41775]",
    viewMore: "bg-[#F3E5F8] text-[#5C2483] hover:bg-[#E8D4F0]",
    badgeBg: "bg-[#5C2483]",
    badgeAccent: "text-white",
    tabActive: "bg-[#5C2483] text-white",
  };
}
