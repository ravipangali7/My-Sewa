import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Send, Smartphone, ChevronRight } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { apiClient } from "@/lib/api";

export const Route = createFileRoute("/app/services")({
  head: () => ({
    meta: [
      { title: "Services — MySewa Wallet" },
      {
        name: "description",
        content:
          "Load your MySewa wallet, recharge NTC or NCELL and send money to any Nepali bank account.",
      },
      { property: "og:title", content: "Services — MySewa Wallet" },
      {
        property: "og:description",
        content: "Wallet load, mobile top-up and bank transfer services in one hub.",
      },
    ],
  }),
  component: Services,
});

const SERVICES = [
  {
    to: "/app/load",
    title: "Load Wallet",
    desc: "Remittance / bank deposit with proof",
    icon: Download,
  },
  { to: "/app/topup", title: "Mobile Top-Up", desc: "NTC · NCELL recharge", icon: Smartphone },
  { to: "/app/transfer", title: "Bank Transfer", desc: "Send to any Nepali bank", icon: Send },
];

function Services() {
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });

  const bank = settingsQuery.data?.bank_details ?? {};
  const bankEntries = Object.entries(bank).filter(([, v]) => v);

  return (
    <UserShell title="Services">
      <div className="space-y-5">
        <ul className="inset-group divide-y divide-border">
          {SERVICES.map((s) => (
            <li key={s.to}>
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
            </li>
          ))}
        </ul>

        <section className="inset-group p-4">
          <h2 className="text-[15px] font-semibold">Company deposit account</h2>
          <dl className="mt-3 space-y-2 text-[15px]">
            {settingsQuery.isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : bankEntries.length === 0 ? (
              <p className="text-muted-foreground">Not configured yet.</p>
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
