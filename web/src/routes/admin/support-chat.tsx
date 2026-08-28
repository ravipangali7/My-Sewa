import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/layout/AdminShell";
import { SupportChatPanel } from "@/components/support-chat/SupportChatPanel";

export const Route = createFileRoute("/admin/support-chat")({
  head: () => ({
    meta: [
      { title: "Support Chat — MySewa Admin" },
      {
        name: "description",
        content: "Reply to Support Chat from users and dealers.",
      },
    ],
  }),
  component: AdminSupportChatPage,
});

function AdminSupportChatPage() {
  return (
    <AdminShell
      title="Support Chat"
      description="View and reply to chats from users and dealers. They can only message Admin."
      dense
    >
      <SupportChatPanel mode="admin" className="h-[calc(100dvh-10.5rem)] min-h-[28rem]" />
    </AdminShell>
  );
}
