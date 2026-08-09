import { CopyableField } from "@/components/CopyableField";
import { enabledPaymentAccounts, methodLabel } from "@/lib/payment-accounts";
import type { BankDetails } from "@/lib/types";
import { useT } from "@/lib/i18n";

type DepositAccountsPanelProps = {
  bankDetails?: BankDetails | null;
  loading?: boolean;
  /** Optional QR shown beside the first account block */
  qrUrl?: string | null;
  qrAlt?: string;
  instructions?: string;
  title?: string;
};

export function DepositAccountsPanel({
  bankDetails,
  loading,
  qrUrl,
  qrAlt,
  instructions,
  title,
}: DepositAccountsPanelProps) {
  const t = useT();
  const accounts = enabledPaymentAccounts(bankDetails);

  return (
    <section className="inset-group min-w-0 max-w-full p-4">
      <h2 className="text-[15px] font-semibold">{title || t("load.depositAccount")}</h2>
      {instructions ? (
        <p className="mt-2 break-words text-[13px] text-muted-foreground whitespace-pre-wrap">
          {instructions}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 text-muted-foreground">{t("load.loadingBank")}</p>
      ) : accounts.length === 0 ? (
        <p className="mt-3 text-muted-foreground">{t("load.bankNotConfigured")}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {qrUrl ? (
            <div className="mx-auto flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-separator bg-muted sm:mx-0">
              <img src={qrUrl} alt={qrAlt || t("load.qrAlt")} className="size-full object-contain" />
            </div>
          ) : null}

          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold">{acc.label || methodLabel(acc.method)}</p>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {acc.method === "khalti"
                    ? t("load.methodKhalti")
                    : acc.method === "esewa"
                      ? t("load.methodEsewa")
                      : t("load.methodBank")}
                </span>
              </div>
              <dl className="min-w-0 space-y-2 text-[14px]">
                {acc.method === "bank" && acc.bank_name ? (
                  <CopyableField label={t("load.bankName")} value={acc.bank_name} mono={false} />
                ) : null}
                {acc.account_name ? (
                  <CopyableField
                    label={
                      acc.method === "bank" ? t("load.accountName") : t("load.accountHolder")
                    }
                    value={acc.account_name}
                    mono={false}
                  />
                ) : null}
                {acc.account_number ? (
                  <CopyableField
                    label={
                      acc.method === "khalti"
                        ? t("load.khaltiId")
                        : acc.method === "esewa"
                          ? t("load.esewaId")
                          : t("load.accountNumber")
                    }
                    value={acc.account_number}
                  />
                ) : null}
                {acc.method === "bank" && acc.branch ? (
                  <CopyableField label={t("load.branch")} value={acc.branch} mono={false} />
                ) : null}
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
