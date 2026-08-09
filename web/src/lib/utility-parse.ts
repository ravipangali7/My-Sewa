export type CounterOption = { value: string; label: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
  const queue: unknown[] = [node];
  const seen = new Set<unknown>();
  while (queue.length) {
    const cur = queue.shift();
    if (cur == null || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) queue.push(item);
      continue;
    }
    if (!isRecord(cur)) continue;
    visit(cur);
    for (const value of Object.values(cur)) {
      if (isRecord(value) || Array.isArray(value)) queue.push(value);
    }
  }
}

function counterValue(item: Record<string, unknown>): string | null {
  return firstString(
    item["office_code"],
    item["counter_code"],
    item["counter"],
    item["code"],
    item["value"],
    item["id"],
    item["slug"],
    item["service_slug"],
    item["name"],
  );
}

function counterLabel(item: Record<string, unknown>, value: string): string {
  const name = firstString(
    item["office_name"],
    item["counter_name"],
    item["name"],
    item["label"],
    item["title"],
    item["description"],
    item["counter"],
    item["counter_code"],
    item["office_code"],
  );
  if (!name || name === value) return value;
  return `${name} (${value})`;
}

function looksLikeCounter(item: Record<string, unknown>): boolean {
  return Boolean(
    item["office_code"] ||
      item["office_name"] ||
      item["counter_code"] ||
      item["counter"] ||
      item["counter_name"] ||
      item["slug"] ||
      item["service_slug"] ||
      ((item["code"] || item["value"] || item["id"]) &&
        (item["name"] || item["label"] || item["title"])),
  );
}

/**
 * Pull selectable counter / slug options from a raw HimalPay response tree.
 */
export function extractCounterOptions(raw: unknown): CounterOption[] {
  const options: CounterOption[] = [];
  const seen = new Set<string>();

  const pushItem = (item: Record<string, unknown>) => {
    const value = counterValue(item);
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({ value, label: counterLabel(item, value) });
  };

  walk(raw, (obj) => {
    for (const [key, value] of Object.entries(obj)) {
      if (!Array.isArray(value) || !value.length) continue;
      const keyLower = key.toLowerCase();
      const isCounterKey =
        keyLower.includes("counter") ||
        keyLower.includes("office") ||
        keyLower.includes("slug") ||
        keyLower === "data" ||
        keyLower === "items" ||
        keyLower === "list" ||
        keyLower === "options";
      if (!isCounterKey && !value.some((x) => isRecord(x) && looksLikeCounter(x))) {
        continue;
      }
      for (const entry of value) {
        if (typeof entry === "string" || typeof entry === "number") {
          const valueText = String(entry).trim();
          if (!valueText || seen.has(valueText)) continue;
          seen.add(valueText);
          options.push({ value: valueText, label: valueText });
          continue;
        }
        if (isRecord(entry) && (looksLikeCounter(entry) || isCounterKey)) {
          pushItem(entry);
        }
      }
    }
  });

  // Fallback: single string-like counter fields on the root payload.
  if (!options.length) {
    walk(raw, (obj) => {
      const value = counterValue(obj);
      if (!value || seen.has(value)) return;
      if (!looksLikeCounter(obj)) return;
      seen.add(value);
      options.push({ value, label: counterLabel(obj, value) });
    });
  }

  return options;
}

function parseAmountLike(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return null;
  const text = String(value).trim().replace(/,/g, "");
  if (!text) return null;
  const num = Number(text);
  if (!Number.isFinite(num) || num < 0) return null;
  return num.toFixed(2);
}

/**
 * Best-effort payable amount from a raw inquiry payload.
 */
export function extractPayableAmount(raw: unknown): string | null {
  let found: string | null = null;
  walk(raw, (obj) => {
    if (found) return;
    found = parseAmountLike(
      obj["payable_amount"] ??
        obj["payableAmount"] ??
        obj["due_amount"] ??
        obj["dueAmount"] ??
        obj["total_amount"] ??
        obj["totalAmount"] ??
        obj["bill_amount"] ??
        obj["billAmount"] ??
        obj["amount"],
    );
  });
  return found;
}

/**
 * Best-effort customer / consumer name from a raw inquiry payload.
 */
export function extractCustomerName(raw: unknown): string | null {
  let found: string | null = null;
  walk(raw, (obj) => {
    if (found) return;
    found = firstString(
      obj["customer_name"],
      obj["customerName"],
      obj["consumer_name"],
      obj["consumerName"],
      obj["account_name"],
      obj["accountName"],
      obj["name"],
    );
    // Avoid treating short codes / counters as names.
    if (found && found.length < 2) found = null;
  });
  return found;
}
