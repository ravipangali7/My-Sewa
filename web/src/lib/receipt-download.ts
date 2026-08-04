import { useState } from "react";
import { toast } from "sonner";
import type { ActivityStatement } from "./activity";
import { buildActivityStatement } from "./activity";
import { downloadStatementPdf } from "./statement-pdf";
import { apiClient } from "./api";
import type { TranslateFn } from "./i18n";
import type { WalletTransactions } from "./types";

export function activityIdForKind(
  kind: string,
  id: number,
): string {
  const map: Record<string, string> = {
    deposit: "dep",
    remittance: "rem",
    topup: "top",
    transfer: "bt",
    internet: "isp",
    data_pack: "data",
  };
  const prefix = map[kind] ?? kind;
  return `${prefix}-${id}`;
}

export async function downloadReceiptPdf({
  tx,
  activityId,
  t,
  initiator,
  logoUrl,
  brandName,
}: {
  tx: WalletTransactions;
  activityId: string;
  t: TranslateFn;
  initiator?: string;
  logoUrl?: string;
  brandName?: string;
}): Promise<boolean> {
  const statement = buildActivityStatement(tx, activityId, t, initiator);
  if (!statement) return false;

  const statusKey = statement.item.status.toLowerCase();
  let title = t("history.detailTitle");
  if (statusKey === "success" || statusKey === "approved") title = t("history.successTitle");
  else if (statusKey === "failed") title = t("history.failedTitle");
  else if (statusKey === "rejected") title = t("history.rejectedTitle");
  else if (statusKey === "pending") title = t("history.pendingTitle");

  await downloadStatementPdf({
    statement,
    title,
    detailsHeading: t("history.transactionDetails"),
    logoUrl,
    brandName: brandName ?? t("history.statementBrand"),
  });
  return true;
}

export async function fetchAndDownloadReceipt({
  activityId,
  t,
  initiator,
  logoUrl,
  brandName,
}: {
  activityId: string;
  t: TranslateFn;
  initiator?: string;
  logoUrl?: string;
  brandName?: string;
}): Promise<void> {
  const tx = await apiClient.walletTransactions();
  const ok = await downloadReceiptPdf({
    tx,
    activityId,
    t,
    initiator,
    logoUrl,
    brandName,
  });
  if (!ok) throw new Error("Receipt not found");
}

export function useReceiptDownload(t: TranslateFn, initiator?: string, logoUrl?: string, brandName?: string) {
  const [downloading, setDownloading] = useState(false);

  async function download(activityId: string) {
    if (downloading) return;
    setDownloading(true);
    try {
      await fetchAndDownloadReceipt({
        activityId,
        t,
        initiator,
        logoUrl,
        brandName,
      });
      toast.success(t("history.downloadPdf"));
    } catch {
      toast.error(t("history.downloadPdfFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return { download, downloading };
}

export function statusHeadlineForStatement(statement: ActivityStatement, t: TranslateFn): string {
  const key = statement.item.status.toLowerCase();
  if (key === "success" || key === "approved") return t("history.successTitle");
  if (key === "failed") return t("history.failedTitle");
  if (key === "rejected") return t("history.rejectedTitle");
  return t("history.pendingTitle");
}
