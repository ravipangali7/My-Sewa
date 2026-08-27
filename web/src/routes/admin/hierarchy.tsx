import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiClient } from "@/lib/api";
import { formatNPR } from "@/lib/format";
import { adminLiveQueryOptions } from "@/lib/refresh";
import type { HierarchyNode } from "@/lib/types";

export const Route = createFileRoute("/admin/hierarchy")({
  head: () => ({
    meta: [
      { title: "Dealer Hierarchy — MySewa Admin" },
      {
        name: "description",
        content: "Expandable Super Admin network tree of Dealers and Sub-Agents.",
      },
    ],
  }),
  component: HierarchyPage,
});

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "", label: "All time" },
];

function StatusBadge({ node }: { node: HierarchyNode }) {
  if (node.wallet_frozen) return <Badge variant="secondary">Frozen</Badge>;
  if (!node.is_active) return <Badge variant="secondary">Inactive</Badge>;
  return (
    <Badge variant={node.account_status === "approved" ? "default" : "secondary"}>
      {node.account_status === "approved" ? "Active" : "Pending"}
    </Badge>
  );
}

function SubAgentRow({ node }: { node: HierarchyNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background px-3 py-2">
      <div>
        <p className="text-sm font-medium">{node.name || node.phone}</p>
        <p className="text-xs text-muted-foreground">
          {node.phone} · {node.role}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{node.customer_count} customers</span>
        <span>{node.transaction_count} txns</span>
        <span>{formatNPR(node.sales)}</span>
        <span>Comm {formatNPR(node.commission ?? "0")}</span>
        <StatusBadge node={node} />
        <Button asChild size="sm" variant="ghost">
          <Link to="/admin/users/$userId/report" params={{ userId: String(node.id) }}>
            Report
          </Link>
        </Button>
      </div>
    </div>
  );
}

function DealerNode({ node }: { node: HierarchyNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 items-center gap-2 text-left">
            <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
            <div>
              <p className="font-semibold">{node.name || node.phone}</p>
              <p className="text-xs text-muted-foreground">Dealer · {node.phone}</p>
            </div>
          </button>
        </CollapsibleTrigger>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <StatusBadge node={node} />
          <span>{node.sub_agent_count ?? 0} sub-agents</span>
          <span>{node.customer_count} customers</span>
          <span>{formatNPR(node.sales)}</span>
          <span>Net {formatNPR(node.net_commission ?? "0")}</span>
          <span>TDS {formatNPR(node.tds_amount ?? "0")}</span>
          <span>Profit {formatNPR(node.super_admin_profit ?? "0")}</span>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/users/$userId" params={{ userId: String(node.id) }}>
              Details
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/users/$userId/report" params={{ userId: String(node.id) }}>
              Report
            </Link>
          </Button>
        </div>
      </div>
      <CollapsibleContent className="space-y-2 border-t border-border px-4 py-3">
        {(node.sub_agents ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No Sub-Agents under this Dealer.</p>
        ) : (
          (node.sub_agents ?? []).map((sub) => <SubAgentRow key={sub.id} node={sub} />)
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function HierarchyPage() {
  const [period, setPeriod] = useState("month");
  const query = useQuery({
    queryKey: ["admin", "hierarchy", period],
    queryFn: () => apiClient.adminHierarchy({ period }),
    ...adminLiveQueryOptions(),
  });
  const items = query.data?.items ?? [];

  return (
    <AdminShell title="Dealer Hierarchy" description="Super Admin → Dealers → Sub-Agents" dense>
      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.id || "all"}
            size="sm"
            variant={period === p.id ? "default" : "outline"}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      {query.isError ? (
        <p className="text-sm text-danger">Failed to load hierarchy.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No dealers in the network yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium">
            Super Admin
          </div>
          {items.map((node) => (
            <DealerNode key={node.id} node={node} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
