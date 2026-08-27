import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { liveQueryOptions } from "@/lib/refresh";

export function useSupportChatUnread() {
  return useQuery({
    queryKey: ["support-chat", "unread"],
    queryFn: () => apiClient.supportChatUnread(),
    ...liveQueryOptions(15_000),
  });
}

export function SupportChatUnreadBadge({ className }: { className?: string }) {
  const unread = useSupportChatUnread();
  const count = unread.data?.count ?? 0;
  if (count <= 0) return null;
  return (
    <span
      className={
        className ??
        "ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground"
      }
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
