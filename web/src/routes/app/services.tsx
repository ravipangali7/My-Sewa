import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Send, Smartphone, ChevronRight, ArrowDownToLine } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/app/services")({
  head: () => ({
    meta: [
      { title: "Services — MySewa Wallet" },
      {
        name: "description",
        content:
          "Receive remittance, load your MySewa wallet, recharge NTC or NCELL and send money to any Nepali bank account.",
      },
      { property: "og:title", content: "Services — MySewa Wallet" },
      {
        property: "og:description",
        content: "Remittance, wallet load, mobile top-up and bank transfer services in one hub.",
      },
    ],
  }),
  component: Services,
});

function Services() {
  const t = useT();
  const { user } = useAuth();
  const accountPending = isAccountPending(user);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });

  const payment = settingsQuery.data?.config?.payment;
  const bank = settingsQuery.data?.bank_details ?? {};
  const bankEntries = Object.entries(bank).filter(([, v]) => v);

  const services = [
    {
      to: "/app/remittance" as const,
      title: t("services.remittance"),
      desc: accountPending
        ? t("services.unavailablePending")
        : t("services.remittanceDesc"),
      icon: ArrowDownToLine,
      enabled: payment?.remittances_enabled !== false && !accountPending,
    },
    {
      to: "/app/load" as const,
      title: t("services.loadWallet"),
      desc: accountPending
        ? t("services.unavailablePending")
        : t("services.loadDesc"),
      icon: Download,
      enabled: payment?.deposits_enabled !== false && !accountPending,
    },
    {
      to: "/app/topup" as const,
      title: t("services.topup"),
      desc: accountPending
        ? t("services.unavailablePending")
        : t("services.topupDesc"),
      icon: Smartphone,
      enabled: payment?.topups_enabled !== false && !accountPending,
    },
    {
      to: "/app/transfer" as const,
      title: t("services.transfer"),
      desc: accountPending
        ? t("services.unavailablePending")
        : t("services.transferDesc"),
      icon: Send,
      enabled: payment?.transfers_enabled !== false && !accountPending,
    },
  ];

  return (
    <UserShell title={t("services.title")}>
      <div className="space-y-5">
        {accountPending ? <AccountPendingBanner /> : null}
        <ul className="inset-group divide-y divide-border">
          {services.map((s) => (
            <li key={s.to}>
              {s.enabled ? (
                <Link to={s.to} className="flex items-center gap-3 px-4 py-4 hover:bg-muted/60">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <s.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-medium">{s.title}</span>
                    <span className="block text-[13px] text-muted-foreground">{s.desc}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-4 opacity-55">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <s.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-medium">{s.title}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {accountPending ? s.desc : t("services.unavailable")}
                    </span>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>

        <section className="inset-group p-4">
          <h2 className="text-[15px] font-semibold">{t("services.depositAccount")}</h2>
          <dl className="mt-3 space-y-2 text-[15px]">
            {settingsQuery.isLoading ? (
              <p className="text-muted-foreground">{t("common.loading")}</p>
            ) : bankEntries.length === 0 ? (
              <p className="text-muted-foreground">{t("services.notConfigured")}</p>
            ) : (
              bankEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))
            )}
          </dl>
        </section>
      </div>
    </UserShell>
  );
}
