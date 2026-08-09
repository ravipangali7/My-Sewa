import { CopyableField } from "@/components/CopyableField";
import { enabledPaymentAccounts, methodLabel } from "@/lib/payment-accounts";
import type { BankDetails } from "@/lib/types";
import { useT } from "@/lib/i18n";

export type DepositQrOption = {
  id: "bank" | "khalti" | "esewa";
  url: string;
  label: string;
  alt?: string;
};

type DepositAccountsPanelProps = {
  bankDetails?: BankDetails | null;
  loading?: boolean;
  /** Optional QR codes shown above account details (single column on mobile) */
  qrOptions?: DepositQrOption[];
  /** @deprecated Prefer qrOptions — kept for single-QR callers */
  qrUrl?: string | null;
  qrAlt?: string;
  instructions?: string;
  title?: string;
};

export function DepositAccountsPanel({
  bankDetails,
  loading,
  qrOptions,
  qrUrl,
  qrAlt,
  instructions,
  title,
}: DepositAccountsPanelProps) {
  const t = useT();
  const accounts = enabledPaymentAccounts(bankDetails);

  const resolvedQrs: DepositQrOption[] =
    qrOptions && qrOptions.length > 0
      ? qrOptions.filter((q) => Boolean(q.url))
      : qrUrl
        ? [{ id: "bank", url: qrUrl, label: t("load.methodBank"), alt: qrAlt }]
        : [];

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
      ) : accounts.length === 0 && resolvedQrs.length === 0 ? (
        <p className="mt-3 text-muted-foreground">{t("load.bankNotConfigured")}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {resolvedQrs.length > 0 ? (
            <div className="flex flex-col gap-3">
              {resolvedQrs.map((qr) => (
                <div
                  key={qr.id}
                  className="mx-auto flex w-full max-w-44 flex-col items-center gap-2 sm:mx-0 sm:max-w-38"
                >
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {qr.label}
                  </p>
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-separator bg-muted">
                    <img
                      src={qr.url}
                      alt={qr.alt || `${qr.label} ${t("load.qrAlt")}`}
                      className="size-full object-contain p-1.5"
                    />
                  </div>
                </div>
              ))}
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
