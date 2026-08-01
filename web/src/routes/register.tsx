import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useSiteBranding } from "@/hooks/use-site-branding";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create Account — MySewa" },
      {
        name: "description",
        content: "Register for a MySewa wallet. New accounts start as Pending until admin approval.",
      },
      { property: "og:title", content: "Create Account — MySewa" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const { register, token, user, isStaff, isLoading } = useAuth();
  const { logoUrl } = useSiteBranding();
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
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
            Join MySewa
          </h2>
          <p className="mt-4 text-primary-foreground/80">
            Create your wallet in seconds. New accounts stay Pending until a Super Admin activates
            them — you can sign in right away, but transactions unlock after approval.
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
            <h1 className="mt-4 text-[34px] font-bold tracking-tight lg:mt-0">Create account</h1>
            <p className="mt-1 text-[15px] text-muted-foreground">
              Register with your phone number
            </p>
          </div>

          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (password !== password2) {
                toast.error("Passwords do not match");
                return;
              }
              if (password.length < 8) {
                toast.error("Password must be at least 8 characters");
                return;
              }
              setSubmitting(true);
              try {
                await register({
                  phone: phone.trim(),
                  password,
                  password2,
                  first_name: firstName.trim(),
                  last_name: lastName.trim(),
                });
                toast.success("Account created", {
                  description: "Your account is Pending until an admin activates it.",
                });
                navigate({ to: "/app" });
              } catch (err) {
                const msg = err instanceof ApiError ? err.message : "Registration failed";
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">First name</Label>
                <Input
                  id="first_name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="h-12 rounded-xl"
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">Last name</Label>
                <Input
                  id="last_name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="h-12 rounded-xl"
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-xl"
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password2">Confirm password</Label>
              <Input
                id="password2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className="h-12 rounded-xl"
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitting ? "Creating…" : "Register"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Already have an account?{" "}
            <Link to="/" className="font-semibold text-foreground underline-offset-2 hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
