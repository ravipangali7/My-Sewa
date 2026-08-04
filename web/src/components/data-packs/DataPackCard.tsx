import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNPR } from "@/lib/format";
import {
  buildPackDescription,
  extractValidityLabel,
  operatorTheme,
  type DataPackOperator,
} from "@/lib/data-packs";
import { useI18n } from "@/lib/i18n";
import type { DataPackOption } from "@/lib/types";
import { OperatorPackBadge } from "./OperatorPackBadge";

export function DataPackCard({
  pkg,
  operator,
  onBuy,
}: {
  pkg: DataPackOption;
  operator: DataPackOperator;
  onBuy: (pkg: DataPackOption) => void;
}) {
  const { t } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const theme = operatorTheme(operator);
  const validity = extractValidityLabel(pkg.name, pkg.validity);
  const description = buildPackDescription(pkg);

  return (
    <>
      <article className="overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-card">
        <div className="flex gap-3 p-3.5">
          <OperatorPackBadge operator={operator} validity={validity} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold leading-snug text-foreground">{pkg.name}</h3>
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 border-t border-border/50 px-3.5 py-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("dataTopup.price")}
            </p>
            <p className="tabular text-[18px] font-bold text-[#1a3a5c]">
              {formatNPR(pkg.amount)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={`h-9 rounded-lg px-3 text-[12px] font-bold uppercase tracking-wide ${theme.viewMore}`}
              onClick={() => setDetailsOpen(true)}
            >
              {t("dataTopup.viewMore")}
            </Button>
            <Button
              type="button"
              size="sm"
              className={`h-9 rounded-lg px-4 text-[12px] font-bold uppercase tracking-wide text-white ${theme.buy}`}
              onClick={() => onBuy(pkg)}
            >
              {t("dataTopup.buy")}
            </Button>
          </div>
        </div>
      </article>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-left text-[17px] leading-snug">{pkg.name}</DialogTitle>
            <DialogDescription className="text-left text-[14px] leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 rounded-xl bg-muted/60 p-3 text-[14px]">
            <DetailRow label={t("dataTopup.price")} value={formatNPR(pkg.amount)} strong />
            {validity ? (
              <DetailRow label={t("dataTopup.validity")} value={validity} />
            ) : null}
            {pkg.volume ? <DetailRow label={t("dataTopup.volume")} value={pkg.volume} /> : null}
            {pkg.package_id ? (
              <DetailRow label={t("dataTopup.packageId")} value={pkg.package_id} />
            ) : null}
          </dl>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              className={`w-full rounded-xl text-[15px] font-semibold text-white sm:w-auto ${theme.buy}`}
              onClick={() => {
                setDetailsOpen(false);
                onBuy(pkg);
              }}
            >
              {t("dataTopup.buyFor", { amount: formatNPR(pkg.amount) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "tabular font-bold text-foreground" : "tabular font-medium"}>
        {value}
      </dd>
    </div>
  );
}
