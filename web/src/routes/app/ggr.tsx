import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Coins,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  History,
  ShieldAlert,
  Plus,
  Play,
  RotateCcw,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app/ggr")({
  component: GgrDashboardScreen,
});

function GgrDashboardScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyAmount, setBuyAmount] = useState("10000");

  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [apiDepositAmount, setApiDepositAmount] = useState("1000");
  const [apiDepositPlayer, setApiDepositPlayer] = useState("player_01");

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [apiWithdrawAmount, setApiWithdrawAmount] = useState("500");
  const [apiWithdrawPlayer, setApiWithdrawPlayer] = useState("player_01");

  const [gameAmount, setGameAmount] = useState("500");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ggr-dashboard"],
    queryFn: () => apiClient.getGgrDashboard(),
  });

  const buyCoinsMutation = useMutation({
    mutationFn: (amount: string) => apiClient.buyGgrCoins(amount),
    onSuccess: (res) => {
      toast.success(res.message);
      setBuyModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to buy GGR coins.");
    },
  });

  const gameEventMutation = useMutation({
    mutationFn: (payload: { event_type: "player_win" | "player_loss"; amount: string }) =>
      apiClient.postGameEvent(payload),
    onSuccess: (res) => {
      toast.success(
        res.event_type === "player_win"
          ? `Player Won! GGR coins increased by ${res.amount} (+10% bonus applied)`
          : `Player Lost! GGR coins decreased by ${Math.abs(Number(res.amount))}`,
      );
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to process game event.");
    },
  });

  const apiDepositMutation = useMutation({
    mutationFn: (payload: { amount: string; player_id: string }) =>
      apiClient.paymentApiDeposit(payload),
    onSuccess: (res) => {
      toast.success(
        `Deposit processed! Fee: NPR ${res.fee_amount} (${res.fee_percent}%), Credited: NPR ${res.net_credited}`,
      );
      setDepositModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Deposit API call failed.");
    },
  });

  const apiWithdrawMutation = useMutation({
    mutationFn: (payload: { amount: string; player_id: string }) =>
      apiClient.paymentApiWithdraw(payload),
    onSuccess: (res) => {
      toast.success(
        `Withdrawal processed! Fee: NPR ${res.fee_amount} (${res.fee_percent}%), Debited: NPR ${res.total_debited}`,
      );
      setWithdrawModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Withdraw API call failed.");
    },
  });

  if (!user?.is_api_user) {
    return (
      <UserShell title="GGR Coin & Payment API">
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold">API User Access Required</h2>
          <p className="text-sm text-gray-600 max-w-md">
            The GGR Coin service and Payment API are restricted. Only a Super Admin or Shareholder
            can activate API access for your account.
          </p>
          <Button asChild variant="outline">
            <Link to="/app">Return to Home</Link>
          </Button>
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell title="GGR & Payment API" back="/app">
      <div className="space-y-6 pb-12">
        {/* Balances Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Main Cash Balance */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-emerald-600" />
                Main Cash Balance
              </span>
              <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                <Link to="/app/load">Deposit Cash</Link>
              </Button>
            </div>
            <div>
              <div className="text-3xl font-extrabold text-foreground">
                {isLoading ? "..." : formatNPR(Number(data?.cash_balance || 0))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used for buying GGR coins, receiving API deposits, and honoring player payouts.
              </p>
            </div>
          </div>

          {/* GGR Coin Balance */}
          <div className="rounded-2xl border bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5 shadow-sm space-y-4 border-amber-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                <Coins className="h-4 w-4 text-amber-600" />
                GGR Coin Balance
              </span>
              <Button
                size="sm"
                onClick={() => setBuyModalOpen(true)}
                className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Buy Coins
              </Button>
            </div>
            <div>
              <div className="text-3xl font-extrabold text-amber-700 flex items-baseline gap-2">
                <span>{isLoading ? "..." : Number(data?.ggr_coin_balance || 0).toLocaleString()}</span>
                <span className="text-sm font-semibold text-amber-600">Coins</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span>Bought: {Number(data?.total_bought || 0).toLocaleString()}</span>
                <span>•</span>
                <span>Won: {Number(data?.total_won || 0).toLocaleString()}</span>
                <span>•</span>
                <span>Lost: {Number(data?.total_lost || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Operations & Monthly Settlement Overview */}
        <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-sm">Monthly GGR Profit & Service Cut</h3>
            </div>
            <div className="text-xs bg-amber-100 text-amber-800 font-semibold px-2.5 py-1 rounded-full">
              Platform Fee: {data?.service_fees?.ggr_monthly_profit_percent || 10}% of Net Profit
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-xl bg-muted/40">
              <div className="text-xs text-muted-foreground">Est. Net Profit</div>
              <div className="text-base font-bold text-foreground mt-0.5">
                {formatNPR(Number(data?.net_profit_estimate || 0))}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40">
              <div className="text-xs text-muted-foreground">Est. 10% Cut</div>
              <div className="text-base font-bold text-amber-700 mt-0.5">
                {formatNPR(Number(data?.estimated_monthly_fee || 0))}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40">
              <div className="text-xs text-muted-foreground">Deposit API Fee</div>
              <div className="text-base font-bold text-foreground mt-0.5">
                {data?.service_fees?.payment_api_deposit_percent || 1.5}%
              </div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40">
              <div className="text-xs text-muted-foreground">Withdraw API Fee</div>
              <div className="text-base font-bold text-foreground mt-0.5">
                {data?.service_fees?.payment_api_withdraw_percent || 2.0}%
              </div>
            </div>
          </div>
        </div>

        {/* Action Tabs: Game Simulator & Payment API Playground */}
        <Tabs defaultValue="gameplay" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="gameplay">Game Simulator</TabsTrigger>
            <TabsTrigger value="payment-api">Payment API</TabsTrigger>
            <TabsTrigger value="ledger">Ledger & History</TabsTrigger>
          </TabsList>

          {/* Gameplay Tab */}
          <TabsContent value="gameplay" className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">GGR Gameplay Movement Simulator</h4>
              <p className="text-xs text-muted-foreground">
                Rule: When player loses, GGR decreases. When player wins, GGR increases with a 10% bonus.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-center">
              <div className="w-full sm:w-60">
                <Label className="text-xs">Amount of Coins</Label>
                <Input
                  type="number"
                  value={gameAmount}
                  onChange={(e) => setGameAmount(e.target.value)}
                  placeholder="e.g. 500"
                />
              </div>

              <div className="flex gap-2 w-full sm:w-auto pt-4">
                <Button
                  onClick={() =>
                    gameEventMutation.mutate({ event_type: "player_win", amount: gameAmount })
                  }
                  disabled={gameEventMutation.isPending}
                  className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <TrendingUp className="h-4 w-4 mr-1.5" />
                  Player Win (+10%)
                </Button>

                <Button
                  onClick={() =>
                    gameEventMutation.mutate({ event_type: "player_loss", amount: gameAmount })
                  }
                  disabled={gameEventMutation.isPending}
                  variant="destructive"
                  className="flex-1 sm:flex-none"
                >
                  <TrendingDown className="h-4 w-4 mr-1.5" />
                  Player Loss (-GGR)
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Payment API Tab */}
          <TabsContent value="payment-api" className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">Payment API (Deposit & Withdraw)</h4>
              <p className="text-xs text-muted-foreground">
                Deposits credit your cash balance (minus service fee). Withdrawals debit your balance (plus service fee).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 border rounded-xl space-y-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm flex items-center gap-1.5">
                    <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                    Deposit API (Payin)
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Fee: {data?.service_fees?.payment_api_deposit_percent}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Credits your MySewa balance when an end-player deposits funds into your platform.
                </p>
                <Button
                  size="sm"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => setDepositModalOpen(true)}
                >
                  Test Deposit API
                </Button>
              </div>

              <div className="p-4 border rounded-xl space-y-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm flex items-center gap-1.5">
                    <ArrowUpRight className="h-4 w-4 text-rose-600" />
                    Withdraw API (Payout)
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Fee: {data?.service_fees?.payment_api_withdraw_percent}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Debits your MySewa balance when an end-player requests a withdrawal from your platform.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-rose-300 text-rose-700 hover:bg-rose-50"
                  onClick={() => setWithdrawModalOpen(true)}
                >
                  Test Withdraw API
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Ledger & History Tab */}
          <TabsContent value="ledger" className="space-y-4">
            <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm flex items-center gap-1.5">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Recent GGR Coin Transactions
                </h4>
                <Button size="sm" variant="ghost" onClick={() => refetch()}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Refresh
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground text-left">
                      <th className="py-2">Type</th>
                      <th className="py-2">Amount</th>
                      <th className="py-2">Balance After</th>
                      <th className="py-2">Reference</th>
                      <th className="py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(data?.recent_transactions || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">
                          No GGR transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      data?.recent_transactions.map((t) => (
                        <tr key={t.id} className="hover:bg-muted/30">
                          <td className="py-2.5 font-medium">{t.type_label}</td>
                          <td
                            className={`py-2.5 font-bold ${
                              Number(t.amount) >= 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {Number(t.amount) > 0 ? `+${t.amount}` : t.amount}
                          </td>
                          <td className="py-2.5">{t.balance_after}</td>
                          <td className="py-2.5 text-muted-foreground font-mono">{t.reference || "-"}</td>
                          <td className="py-2.5 text-muted-foreground">{formatDateTime(t.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Buy GGR Coins Dialog */}
      <Dialog open={buyModalOpen} onOpenChange={setBuyModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-600" />
              Buy GGR Coins
            </DialogTitle>
            <DialogDescription>
              Exchange cash balance for GGR coins at 1 NPR = 1 Coin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="text-xs p-3 rounded-lg bg-muted flex justify-between">
              <span>Available Cash Balance:</span>
              <span className="font-bold">{formatNPR(Number(data?.cash_balance || 0))}</span>
            </div>

            <div className="space-y-2">
              <Label>Amount (NPR)</Label>
              <Input
                type="number"
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
                placeholder="10000"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => buyCoinsMutation.mutate(buyAmount)}
              disabled={buyCoinsMutation.isPending}
            >
              Confirm Purchase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Deposit Dialog */}
      <Dialog open={depositModalOpen} onOpenChange={setDepositModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment API: End-Player Deposit</DialogTitle>
            <DialogDescription>
              Simulate an incoming player deposit. Platform fee will be deducted and distributed to Shareholders.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Player ID</Label>
              <Input
                value={apiDepositPlayer}
                onChange={(e) => setApiDepositPlayer(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount (NPR)</Label>
              <Input
                type="number"
                value={apiDepositAmount}
                onChange={(e) => setApiDepositAmount(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositModalOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() =>
                apiDepositMutation.mutate({
                  amount: apiDepositAmount,
                  player_id: apiDepositPlayer,
                })
              }
              disabled={apiDepositMutation.isPending}
            >
              Execute Deposit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Withdraw Dialog */}
      <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment API: End-Player Withdrawal</DialogTitle>
            <DialogDescription>
              Simulate a player withdrawal payout. Total amount + platform fee will be debited from your balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Player ID</Label>
              <Input
                value={apiWithdrawPlayer}
                onChange={(e) => setApiWithdrawPlayer(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount (NPR)</Label>
              <Input
                type="number"
                value={apiWithdrawAmount}
                onChange={(e) => setApiWithdrawAmount(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                apiWithdrawMutation.mutate({
                  amount: apiWithdrawAmount,
                  player_id: apiWithdrawPlayer,
                })
              }
              disabled={apiWithdrawMutation.isPending}
            >
              Execute Withdrawal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UserShell>
  );
}
