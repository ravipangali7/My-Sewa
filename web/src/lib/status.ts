import type { MessageKey, TranslateFn } from "./i18n";

const STATUS_LABEL: Record<string, MessageKey> = {
  pending: "status.pending",
  approved: "status.approved",
  rejected: "status.rejected",
  success: "status.success",
  failed: "status.failed",
  not_submitted: "status.notSubmitted",
};

/** Normalize backend status / status_display strings to a catalog key. */
function normalizeStatus(status: string): string {
  const raw = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (STATUS_LABEL[raw]) return raw;
  if (raw.includes("not_submit") || raw === "notsubmitted") return "not_submitted";
  if (raw.includes("reject")) return "rejected";
  if (raw.includes("approv") || raw.includes("credit")) return "approved";
  if (raw.includes("success") || raw.includes("complete")) return "success";
  if (raw.includes("fail")) return "failed";
  if (raw.includes("pend") || raw.includes("review") || raw.includes("process")) {
    return "pending";
  }
  return raw;
}

/** Map backend status / status_display enums to the active locale. */
export function translateStatus(status: string, t: TranslateFn): string {
  const key = STATUS_LABEL[normalizeStatus(status)];
  return key ? t(key) : status;
}
