import { CopyableField } from "@/components/CopyableField";
import { enabledPaymentAccounts, methodLabel } from "@/lib/payment-accounts";
import type { BankDetails, PaymentMethod } from "@/lib/types";
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
  /**
   * Method-level QR fallbacks used when an account has no qr_code_url of its own.
   * Prefer per-account QR from bank_details.accounts[].
   */
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

  const methodQrFallback: Partial<Record<PaymentMethod, DepositQrOption>> = {};
  if (qrOptions?.length) {
    for (const q of qrOptions) {
      if (q.url) methodQrFallback[q.id] = q;
    }
  } else if (qrUrl) {
    methodQrFallback.bank = {
      id: "bank",
      url: qrUrl,
      label: t("load.methodBank"),
      alt: qrAlt,
    };
  }

  const accountQrSrc = (method: PaymentMethod, accountQr?: string | null) => {
    if (accountQr) return { url: accountQr, label: null as string | null, alt: undefined as string | undefined };
    const fallback = methodQrFallback[method];
    if (!fallback?.url) return null;
    return { url: fallback.url, label: fallback.label, alt: fallback.alt };
  };

  /** Method QRs that are not already shown on any enabled account (orphan fallbacks). */
  const usedMethods = new Set(
    accounts
      .map((acc) => (acc.qr_code_url || methodQrFallback[acc.method]?.url ? acc.method : null))
      .filter(Boolean),
  );
  const orphanMethodQrs = (Object.values(methodQrFallback) as DepositQrOption[]).filter(
    (q) => q.url && !usedMethods.has(q.id),
  );

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
      ) : accounts.length === 0 && orphanMethodQrs.length === 0 ? (
        <p className="mt-3 text-muted-foreground">{t("load.bankNotConfigured")}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {orphanMethodQrs.length > 0 ? (
            <div className="flex flex-col gap-3">
              {orphanMethodQrs.map((qr) => (
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

          {accounts.map((acc) => {
            const qr = accountQrSrc(acc.method, acc.qr_code_url);
            return (
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
                {qr ? (
                  <div className="mb-3 mx-auto flex w-full max-w-44 flex-col items-center gap-2 sm:mx-0 sm:max-w-38">
                    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-separator bg-muted">
                      <img
                        src={qr.url}
                        alt={
                          qr.alt ||
                          `${acc.label || methodLabel(acc.method)} ${t("load.qrAlt")}`
                        }
                        className="size-full object-contain p-1.5"
                      />
                    </div>
                  </div>
                ) : null}
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
            );
          })}
        </div>
      )}
    </section>
  );
}
