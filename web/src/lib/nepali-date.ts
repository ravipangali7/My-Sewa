// Vendored (MIT) so builds don't depend on npm resolving `nepali-date-converter`.
import NepaliDateModule, { dateConfigMap } from "./vendor/nepali-date-converter.js";

/** CJS/ESM interop - bundlers may expose the class on `.default`. */
const NepaliDate =
  (NepaliDateModule as unknown as { default?: typeof NepaliDateModule })
    .default ?? NepaliDateModule;

export { NepaliDate, dateConfigMap };

export type BsParts = {
  year: number;
  /** 0â€“11 (Baisakhâ€“Chaitra) */
  month: number;
  day: number;
};

const MONTH_KEYS = [
  "Baisakh",
  "Jestha",
  "Asar",
  "Shrawan",
  "Bhadra",
  "Aswin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const BS_MONTH_NAMES_EN = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const BS_MONTH_NAMES_NP = [
  "à¤¬à¥ˆà¤¶à¤¾à¤–",
  "à¤œà¥‡à¤ ",
  "à¤…à¤¸à¤¾à¤°",
  "à¤¸à¤¾à¤‰à¤¨",
  "à¤­à¤¦à¥Œ",
  "à¤…à¤¸à¥‹à¤œ",
  "à¤•à¤¾à¤¤à¥à¤¤à¤¿à¤•",
  "à¤®à¤‚à¤¸à¤¿à¤°",
  "à¤ªà¥à¤¸",
  "à¤®à¤¾à¤˜",
  "à¤«à¤¾à¤—à¥à¤¨",
  "à¤šà¥ˆà¤¤",
] as const;

export const BS_WEEKDAYS_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
export const BS_WEEKDAYS_NP = ["à¤†", "à¤¸à¥‹", "à¤®", "à¤¬à¥", "à¤¬à¤¿", "à¤¶à¥", "à¤¶"] as const;

const NP_DIGITS = ["à¥¦", "à¥§", "à¥¨", "à¥©", "à¥ª", "à¥«", "à¥¬", "à¥­", "à¥®", "à¥¯"] as const;

export const BS_YEAR_MIN = 2000;
export const BS_YEAR_MAX = 2090;

export function toNepaliDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => NP_DIGITS[Number(d)] ?? d);
}

export function getBsYears(): number[] {
  const years: number[] = [];
  for (let y = BS_YEAR_MAX; y >= BS_YEAR_MIN; y -= 1) years.push(y);
  return years;
}

export function getDaysInBsMonth(year: number, monthIndex: number): number {
  const config = dateConfigMap[String(year)];
  const monthKey = MONTH_KEYS[monthIndex];
  if (!config || !monthKey) return 30;
  return config[monthKey];
}

export function todayBs(): BsParts {
  const nd = NepaliDate.now();
  return { year: nd.getYear(), month: nd.getMonth(), day: nd.getDate() };
}

export function parseAdIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatAdIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function adIsoToBs(iso: string): BsParts | null {
  const ad = parseAdIso(iso);
  if (!ad) return null;
  try {
    const nd = NepaliDate.fromAD(ad);
    const year = nd.getYear();
    if (year < BS_YEAR_MIN || year > BS_YEAR_MAX) return null;
    return { year, month: nd.getMonth(), day: nd.getDate() };
  } catch {
    return null;
  }
}

export function bsToAdIso(parts: BsParts): string | null {
  try {
    const days = getDaysInBsMonth(parts.year, parts.month);
    if (
      parts.year < BS_YEAR_MIN ||
      parts.year > BS_YEAR_MAX ||
      parts.month < 0 ||
      parts.month > 11 ||
      parts.day < 1 ||
      parts.day > days
    ) {
      return null;
    }
    const nd = new NepaliDate(parts.year, parts.month, parts.day);
    return formatAdIso(nd.toJsDate());
  } catch {
    return null;
  }
}

export function formatBsDisplay(
  parts: BsParts,
  locale: "en" | "ne",
  style: "long" | "short" = "long",
): string {
  const monthName =
    locale === "ne" ? BS_MONTH_NAMES_NP[parts.month] : BS_MONTH_NAMES_EN[parts.month];
  if (style === "short") {
    const raw = `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    return locale === "ne" ? toNepaliDigits(raw) : raw;
  }
  const day = locale === "ne" ? toNepaliDigits(parts.day) : String(parts.day);
  const year = locale === "ne" ? toNepaliDigits(parts.year) : String(parts.year);
  return `${monthName} ${day}, ${year}`;
}

/** Convert an AD ISO date (YYYY-MM-DD or datetime) to a BS display string. */
export function formatAdIsoAsBs(
  iso: string | null | undefined,
  locale: "en" | "ne",
  style: "long" | "short" = "long",
): string | null {
  if (!iso) return null;
  const datePart = iso.trim().slice(0, 10);
  const parts = adIsoToBs(datePart);
  if (!parts) return null;
  return formatBsDisplay(parts, locale, style);
}

/** Normalize API date values to YYYY-MM-DD for BsDatePicker. */
export function toAdIsoDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? "";
}

export function getBsMonthGrid(year: number, month: number): Array<number | null> {
  const days = getDaysInBsMonth(year, month);
  const first = new NepaliDate(year, month, 1);
  const startWeekday = first.getDay(); // 0 = Sunday
  const cells: Array<number | null> = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function clampBsDay(year: number, month: number, day: number): number {
  const max = getDaysInBsMonth(year, month);
  return Math.min(Math.max(1, day), max);
}

export function isSameBs(a: BsParts | null, b: BsParts | null): boolean {
  if (!a || !b) return false;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
