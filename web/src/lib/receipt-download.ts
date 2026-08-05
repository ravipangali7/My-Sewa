import { useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { buildActivityStatement, type ActivityKind } from "@/lib/activity";
import { downloadStatementPdf } from "@/lib/statement-pdf";
import type { TranslateFn } from "@/lib/i18n";

const ACTIVITY_PREFIX_BY_KIND: Record<ActivityKind, string> = {
  deposit: "dep",
  remittance: "rem",
  topup: "top",
  transfer: "bt",
  internet: "isp",
  data_pack: "data",
  wallet_adjustment: "adj",
};

export function activityIdForKind(kind: ActivityKind, id: number) {
  return `${ACTIVITY_PREFIX_BY_KIND[kind]}-${id}`;
}

export function useReceiptDownload(t: TranslateFn, initiator?: string, logoUrl?: string) {
  const [downloading, setDownloading] = useState(false);

  const download = async (activityId: string) => {
    if (!activityId || downloading) return;

    setDownloading(true);
    try {
      const tx = await apiClient.walletTransactions();
      const statement = buildActivityStatement(tx, activityId, t, initiator);
      if (!statement) {
        toast.error("Receipt not found.");
        return;
      }
      await downloadStatementPdf({
        statement,
        title: "Transaction Statement",
        detailsHeading: "Transaction Details",
        logoUrl: logoUrl || "/logo.png",
        brandName: "MySewa",
      });
    } catch {
      toast.error("Could not download receipt.");
    } finally {
      setDownloading(false);
    }
  };

  return { download, downloading };
}
