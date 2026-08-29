import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { UserShell } from "@/components/layout/UserShell";
import { ChatPeerTitle, SupportChatPanel } from "@/components/support-chat/SupportChatPanel";
import { useAuth } from "@/lib/auth";
import { isNetworkRole } from "@/lib/auth-destination";
import { useT } from "@/lib/i18n";
import type { SupportChatUser } from "@/lib/types";

export const Route = createFileRoute("/app/support-chat")({
  head: () => ({
    meta: [
      { title: "Support Chat — MySewa" },
      {
        name: "description",
        content: "Chat with MySewa Admin. Users and dealers cannot message each other.",
      },
    ],
  }),
  component: AppSupportChatPage,
});

function AppSupportChatPage() {
  const t = useT();
  const { user } = useAuth();
  const dealer = isNetworkRole(user);
  const [peer, setPeer] = useState<SupportChatUser | null>(null);
  const onPeerChange = useCallback((next: SupportChatUser | null) => {
    setPeer(next);
  }, []);

  return (
    <UserShell
      title={t("chat.title")}
      {...(dealer ? {} : { back: "/app" })}
      disablePullToRefresh
      fillHeight
      titleContent={peer ? <ChatPeerTitle user={peer} /> : undefined}
    >
      <SupportChatPanel mode="user" onPeerChange={onPeerChange} className="h-full min-h-0" />
    </UserShell>
  );
}
