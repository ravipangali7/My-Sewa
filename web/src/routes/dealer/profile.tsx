import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthSessionLoader } from "@/components/AuthSessionLoader";

export const Route = createFileRoute("/dealer/profile")({
  head: () => ({ meta: [{ title: "Profile — Dealer Portal" }] }),
  component: DealerProfileRedirect,
});

function DealerProfileRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/app/profile", replace: true });
  }, [navigate]);
  return <AuthSessionLoader />;
}
