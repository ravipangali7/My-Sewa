import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useSiteBranding } from "@/hooks/use-site-branding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MySewa — Nepal Digital Wallet, Remittance & Top-Up" },
      {
        name: "description",
        content:
          "MySewa is a Nepal digital wallet: load remittance into your wallet, send bank transfers and recharge NTC or NCELL in seconds.",
      },
      { property: "og:title", content: "MySewa — Nepal Digital Wallet, Remittance & Top-Up" },
      {
        property: "og:description",
        content:
          "MySewa is a Nepal digital wallet: load remittance into your wallet, send bank transfers and recharge NTC or NCELL in seconds.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { login, token, user, isStaff, isLoading } = useAuth();
  const { logoUrl } = useSiteBranding();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (token && !isLoading && user) {
      navigate({ to: isStaff ? "/admin" : "/app" });
    }
  }, [token, isLoading, user, isStaff, navigate]);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-hero-gradient p-12 lg:flex">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="size-11 rounded-2xl object-cover" />
          <span className="text-2xl font-bold text-primary-foreground">MySewa</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl leading-tight font-bold text-primary-foreground">
            सजिलो, सुरक्षित, हाम्रो सँग
          </h2>
          <p className="mt-4 text-primary-foreground/80">
            Receive remittance into your wallet, transfer to any Nepali bank account and recharge
            NTC or NCELL — all from one balance.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} MySewa Pvt. Ltd. · Kathmandu, Nepal
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center lg:items-start">
            <img src={logoUrl} alt="MySewa" className="size-14 rounded-2xl object-cover lg:hidden" />
            <h1 className="mt-4 text-[34px] font-bold tracking-tight lg:mt-0">Welcome back</h1>
            <p className="mt-1 text-[15px] text-muted-foreground">Sign in with your phone number</p>
          </div>

          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                const profile = await login(phone.trim(), password);
                const staff = profile.is_staff || profile.is_superuser;
                toast.success("Login successful");
                navigate({ to: staff ? "/admin" : "/app" });
              } catch (err) {
                const msg = err instanceof ApiError ? err.message : "Login failed";
                toast.error(msg);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-12 rounded-xl"
                placeholder="98XXXXXXXX"
                required
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-[13px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-xl"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitting ? "Signing in…" : "Log in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            New to MySewa?{" "}
            <Link
              to="/register"
              className="font-semibold text-foreground underline-offset-2 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
