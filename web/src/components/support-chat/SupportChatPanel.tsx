import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  FileUp,
  ImagePlus,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  ArrowLeft,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { apiClient, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { isMySewaNativeApp, requestNativeCameraPermission } from "@/lib/native-app";
import { liveQueryOptions } from "@/lib/refresh";
import {
  classifyLocalFile,
  isAllowedChatFile,
  maxBytesForKind,
  SUPPORT_CHAT_ACCEPT_FILES,
  SUPPORT_CHAT_ACCEPT_MEDIA,
} from "@/lib/support-chat-media";
import type { SupportChatThread, SupportChatUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ConversationUnreadBadge,
  markSupportChatThreadReadInCache,
} from "@/hooks/use-support-chat-unread";
import { SupportChatMessageBubble } from "./SupportChatMessageBubble";

const THREAD_STORAGE_KEY = "mysewa-support-chat-thread";

function isSupportAdmin(user: SupportChatUser) {
  return Boolean(user.is_superuser || user.is_staff || user.identity_hidden);
}

function readStoredThreadId() {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(THREAD_STORAGE_KEY);
  const id = raw ? Number(raw) : NaN;
  return Number.isFinite(id) ? id : null;
}

export function ChatPeerTitle({ user }: { user: SupportChatUser }) {
  const t = useT();
  const hidden = isHiddenAdmin(user);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-9 shrink-0">
        {!hidden && user.avatar_url ? <AvatarImage src={user.avatar_url} alt={user.name} /> : null}
        <AvatarFallback className="bg-muted text-xs font-semibold">{initials(user)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-tight">
          {hidden ? "Super Admin" : user.name}
        </p>
        <p className="truncate text-[11px] leading-tight opacity-80">
          {hidden
            ? t("chat.supportSubtitle")
            : `${user.role_label}${user.phone ? ` · ${user.phone}` : ""}`}
        </p>
      </div>
    </div>
  );
}

function isHiddenAdmin(user: SupportChatUser | null | undefined) {
  return Boolean(user?.identity_hidden || (user?.is_superuser && user.phone === ""));
}

function initials(user: SupportChatUser) {
  if (isHiddenAdmin(user)) return "SA";
  return (
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || (user.phone || "U").slice(0, 2)
  );
}

function PersonRow({
  name,
  phone,
  roleLabel,
  avatarUrl,
  preview,
  unread,
  active,
  identityHidden,
  onClick,
}: {
  name: string;
  phone: string;
  roleLabel: string;
  avatarUrl: string | null;
  preview?: string;
  unread?: number;
  active?: boolean;
  identityHidden?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const displayName = identityHidden ? "Super Admin" : name;
  const person: SupportChatUser = {
    id: 0,
    phone: identityHidden ? "" : phone,
    name: displayName,
    role: identityHidden ? "admin" : "customer",
    role_label: identityHidden ? "Super Admin" : roleLabel,
    is_staff: Boolean(identityHidden),
    is_superuser: Boolean(identityHidden),
    avatar_url: identityHidden ? null : avatarUrl,
    identity_hidden: Boolean(identityHidden),
  };
  const subtitle = preview || (identityHidden ? t("chat.supportSubtitle") : phone);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active ? "bg-brand-soft text-brand-dark" : "hover:bg-muted",
      )}
    >
      <Avatar className="size-10 shrink-0">
        {!identityHidden && avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
        <AvatarFallback className="bg-muted text-xs font-semibold">{initials(person)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "truncate text-sm",
              unread && unread > 0 ? "font-semibold text-foreground" : "font-medium",
            )}
          >
            {displayName}
          </p>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {identityHidden ? "Super Admin" : roleLabel}
          </span>
        </div>
        <p
          className={cn(
            "truncate text-[12px]",
            unread && unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {subtitle}
        </p>
      </div>
      <ConversationUnreadBadge count={unread ?? 0} />
    </button>
  );
}

export function SupportChatPanel({
  className,
  mode = "user",
  onPeerChange,
}: {
  className?: string;
  mode?: "admin" | "user";
  onPeerChange?: (peer: SupportChatUser | null) => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(() =>
    mode === "admin" ? null : readStoredThreadId(),
  );
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraPhotoRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!pendingFile) {
      setPendingPreview(null);
      return;
    }
    const kind = classifyLocalFile(pendingFile);
    if (kind === "image" || kind === "video") {
      const url = URL.createObjectURL(pendingFile);
      setPendingPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPendingPreview(null);
    return undefined;
  }, [pendingFile]);

  const threadsQuery = useQuery({
    queryKey: ["support-chat", "threads"],
    queryFn: () => apiClient.supportChatThreads(),
    ...liveQueryOptions(8_000),
  });
  const contactsQuery = useQuery({
    queryKey: ["support-chat", "contacts", debouncedQuery],
    queryFn: () => apiClient.supportChatContacts(debouncedQuery),
    ...liveQueryOptions(30_000),
  });
  const messagesQuery = useQuery({
    queryKey: ["support-chat", "messages", selectedThreadId],
    queryFn: () => apiClient.supportChatMessages(selectedThreadId!),
    enabled: selectedThreadId != null,
    ...liveQueryOptions(3_000),
  });

  const startMutation = useMutation({
    mutationFn: (userId: number) => apiClient.supportChatStartThread(userId),
    onSuccess: (thread) => {
      setSelectedThreadId(thread.id);
      void queryClient.invalidateQueries({ queryKey: ["support-chat"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t("chat.startFailed"));
    },
  });

  const sendMutation = useMutation({
    mutationFn: (payload: { body?: string; file?: File; clientNonce: string }) =>
      apiClient.supportChatSendMessage(
        selectedThreadId!,
        payload,
        payload.file ? (pct) => setUploadPct(pct) : undefined,
      ),
    onSuccess: () => {
      setDraft("");
      setPendingFile(null);
      setUploadPct(null);
      void queryClient.invalidateQueries({ queryKey: ["support-chat"] });
    },
    onError: (err) => {
      setUploadPct(null);
      toast.error(err instanceof ApiError ? err.message : t("chat.sendFailed"));
    },
  });

  const threads = threadsQuery.data?.items ?? [];
  const contacts = contactsQuery.data?.items ?? [];
  const messages = messagesQuery.data?.items ?? [];
  const searching = Boolean(debouncedQuery);

  useEffect(() => {
    if (selectedThreadId == null || !messagesQuery.isSuccess) return;
    markSupportChatThreadReadInCache(queryClient, selectedThreadId);
  }, [messagesQuery.dataUpdatedAt, messagesQuery.isSuccess, queryClient, selectedThreadId]);
  const threadByUserId = useMemo(() => {
    const map = new Map<number, SupportChatThread>();
    for (const thread of threads) map.set(thread.other_user.id, thread);
    return map;
  }, [threads]);

  const listItems = useMemo(() => {
    if (searching) {
      return contacts.map((contact) => {
        const existing = threadByUserId.get(contact.id);
        return {
          key: `c-${contact.id}`,
          user: contact,
          thread: existing ?? null,
          preview: existing?.last_message_preview || (isHiddenAdmin(contact) ? t("chat.supportSubtitle") : contact.phone),
          unread:
            existing && existing.id === selectedThreadId ? 0 : existing?.unread_count ?? 0,
        };
      });
    }
    const seen = new Set<number>();
    const items: Array<{
      key: string;
      user: SupportChatUser;
      thread: SupportChatThread | null;
      preview: string;
      unread: number;
    }> = [];
    for (const thread of threads) {
      seen.add(thread.other_user.id);
      items.push({
        key: `t-${thread.id}`,
        user: thread.other_user,
        thread,
        preview: thread.last_message_preview || (isHiddenAdmin(thread.other_user) ? t("chat.supportSubtitle") : thread.other_user.phone),
        unread: thread.id === selectedThreadId ? 0 : thread.unread_count,
      });
    }
    const leftover = contacts.filter((contact) => !seen.has(contact.id));
    const includeLeftover = mode === "admin" ? leftover.length <= 20 : items.length === 0;
    if (includeLeftover) {
      for (const contact of leftover) {
        items.push({
          key: `c-${contact.id}`,
          user: contact,
          thread: null,
          preview: isHiddenAdmin(contact) ? t("chat.supportSubtitle") : contact.phone,
          unread: 0,
        });
      }
    }
    if (mode === "admin" && !searching) {
      items.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0));
    }
    return items;
  }, [contacts, mode, searching, selectedThreadId, t, threadByUserId, threads]);

  const inboxUnread = useMemo(
    () =>
      threads.reduce(
        (sum, thread) => sum + (thread.id === selectedThreadId ? 0 : thread.unread_count),
        0,
      ),
    [selectedThreadId, threads],
  );

  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const selectedUser = selectedThread?.other_user
    ?? listItems.find((item) => item.thread?.id === selectedThreadId)?.user
    ?? null;
  const selectedHidden = isHiddenAdmin(selectedUser);
  const adminPeer =
    threads.find((thread) => isSupportAdmin(thread.other_user))?.other_user
    ?? contacts.find((contact) => isSupportAdmin(contact))
    ?? listItems.find((item) => isSupportAdmin(item.user))?.user
    ?? null;
  const peer = selectedUser ?? (mode === "user" ? adminPeer : null);
  const threadExists =
    selectedThreadId != null && threads.some((thread) => thread.id === selectedThreadId);

  useEffect(() => {
    if (selectedThreadId != null) {
      window.sessionStorage.setItem(THREAD_STORAGE_KEY, String(selectedThreadId));
    }
  }, [selectedThreadId]);

  useEffect(() => {
    onPeerChange?.(peer);
  }, [peer, onPeerChange]);

  useEffect(() => {
    return () => onPeerChange?.(null);
  }, [onPeerChange]);

  useEffect(() => {
    if (mode !== "user") return;
    if (!threadsQuery.isFetched) return;
    if (threadExists) return;
    const adminThread = threads.find((thread) => isSupportAdmin(thread.other_user));
    if (adminThread) {
      setSelectedThreadId(adminThread.id);
      return;
    }
    if (autoStarted.current || startMutation.isPending || contactsQuery.isLoading) return;
    const adminContact = contacts.find((contact) => isSupportAdmin(contact));
    if (!adminContact) return;
    autoStarted.current = true;
    startMutation.mutate(adminContact.id);
  }, [
    contacts,
    contactsQuery.isLoading,
    mode,
    startMutation.isPending,
    startMutation.mutate,
    threadExists,
    threads,
    threadsQuery.isFetched,
  ]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedThreadId]);

  const openPerson = (person: SupportChatUser, thread: SupportChatThread | null) => {
    if (thread) {
      setSelectedThreadId(thread.id);
      return;
    }
    startMutation.mutate(person.id);
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    if (!isAllowedChatFile(file)) {
      toast.error(t("chat.fileTypeNotAllowed"));
      return;
    }
    const kind = classifyLocalFile(file);
    if (file.size > maxBytesForKind(kind)) {
      toast.error(t("chat.fileTooLarge"));
      return;
    }
    setPendingFile(file);
    setAttachOpen(false);
  };

  const openCapture = async (input: HTMLInputElement | null) => {
    setAttachOpen(false);
    if (isMySewaNativeApp()) {
      await requestNativeCameraPermission();
    }
    input?.click();
  };

  const send = () => {
    const body = draft.trim();
    if ((!body && !pendingFile) || selectedThreadId == null || sendMutation.isPending) return;
    const clientNonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    if (pendingFile) setUploadPct(0);
    sendMutation.mutate(
      pendingFile ? { body, file: pendingFile, clientNonce } : { body, clientNonce },
    );
  };

  const showChat = selectedThreadId != null;
  const userDirectChat = mode === "user";
  const canSend = Boolean(draft.trim() || pendingFile) && !sendMutation.isPending;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-surface",
        className,
      )}
    >
      <aside
        className={cn(
          "flex min-h-0 w-full flex-col border-border md:w-[20rem] md:border-r",
          userDirectChat || showChat ? "hidden md:flex" : "flex",
        )}
      >
        {mode === "user" && adminPeer ? (
          <div className="hidden border-b border-border px-3 py-2.5 md:flex">
            <ChatPeerTitle user={adminPeer} />
          </div>
        ) : null}
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(mode === "admin" ? "chat.searchPlaceholderAdmin" : "chat.searchPlaceholder")}
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <p className="mt-2 px-0.5 text-[11px] text-muted-foreground">
            {t(mode === "admin" ? "chat.authorizedHintAdmin" : "chat.authorizedHint")}
          </p>
          {mode === "admin" && inboxUnread > 0 ? (
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#FF3B30]/10 px-2.5 py-2">
              <ConversationUnreadBadge count={inboxUnread} />
              <p className="text-[12px] font-semibold text-[#B42318]">
                {inboxUnread === 1
                  ? t("chat.newMessage")
                  : t("chat.newMessages", { count: inboxUnread })}
              </p>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {threadsQuery.isLoading || contactsQuery.isLoading ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : listItems.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <MessageCircle className="mb-3 size-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">{t("chat.emptyTitle")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t(mode === "admin" ? "chat.emptyBodyAdmin" : "chat.emptyBody")}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {listItems.map((item) => (
                <PersonRow
                  key={item.key}
                  name={item.user.name}
                  phone={item.user.phone}
                  roleLabel={item.user.role_label}
                  avatarUrl={item.user.avatar_url}
                  preview={item.preview}
                  unread={item.unread}
                  identityHidden={isHiddenAdmin(item.user)}
                  active={item.thread?.id === selectedThreadId}
                  onClick={() => openPerson(item.user, item.thread)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          userDirectChat || showChat ? "flex" : "hidden md:flex",
        )}
      >
        {selectedThreadId == null || !selectedUser ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <MessageCircle className="mb-3 size-12 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t("chat.selectTitle")}</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              {t(mode === "admin" ? "chat.selectBodyAdmin" : "chat.selectBody")}
            </p>
          </div>
        ) : (
          <>
            <header
              className={cn(
                "flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5",
                mode === "user" && "hidden md:flex",
              )}
            >
              <button
                type="button"
                className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted md:hidden"
                aria-label={t("common.goBack")}
                onClick={() => setSelectedThreadId(null)}
              >
                <ArrowLeft className="size-4" />
              </button>
              <Avatar className="size-9">
                {!selectedHidden && selectedUser.avatar_url ? (
                  <AvatarImage src={selectedUser.avatar_url} alt={selectedUser.name} />
                ) : null}
                <AvatarFallback className="text-xs">{initials(selectedUser)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {selectedHidden ? "Super Admin" : selectedUser.name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {selectedHidden
                    ? t("chat.supportSubtitle")
                    : `${selectedUser.role_label}${selectedUser.phone ? ` · ${selectedUser.phone}` : ""}`}
                </p>
              </div>
            </header>
            <div
              ref={listRef}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain bg-muted/30 px-3 py-4"
            >
              {messagesQuery.isLoading ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("chat.noMessages")}</p>
              ) : (
                messages.map((message) => {
                  const mine =
                    mode === "admin"
                      ? Boolean(message.sender_is_support)
                      : message.sender_id === user?.id;
                  return (
                    <SupportChatMessageBubble key={message.id} message={message} mine={mine} />
                  );
                })
              )}
            </div>
            {pendingFile ? (
              <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-3 py-2">
                {pendingPreview && classifyLocalFile(pendingFile) === "image" ? (
                  <img src={pendingPreview} alt="" className="size-12 rounded-lg object-cover" />
                ) : pendingPreview && classifyLocalFile(pendingFile) === "video" ? (
                  <video src={pendingPreview} className="size-12 rounded-lg object-cover" muted />
                ) : (
                  <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                    <FileUp className="size-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{pendingFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">{formatBytes(pendingFile.size)}</p>
                  {uploadPct != null ? <Progress value={uploadPct} className="mt-1 h-1.5" /> : null}
                </div>
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted"
                  aria-label={t("chat.removeAttachment")}
                  disabled={sendMutation.isPending}
                  onClick={() => setPendingFile(null)}
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}
            {uploadPct != null && !pendingFile ? (
              <div className="border-t border-border px-3 py-2">
                <p className="mb-1 text-[11px] text-muted-foreground">{t("chat.uploading")}</p>
                <Progress value={uploadPct} className="h-1.5" />
              </div>
            ) : null}
            <form
              className="flex shrink-0 items-end gap-2 border-t border-border bg-surface p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <Popover open={attachOpen} onOpenChange={setAttachOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0 rounded-full"
                    aria-label={t("chat.attach")}
                    disabled={sendMutation.isPending}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-52 p-1.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted"
                    onClick={() => {
                      setAttachOpen(false);
                      galleryRef.current?.click();
                    }}
                  >
                    <ImagePlus className="size-4" />
                    {t("chat.attachPhoto")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted"
                    onClick={() => void openCapture(cameraPhotoRef.current)}
                  >
                    <Camera className="size-4" />
                    {t("chat.takePhoto")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted"
                    onClick={() => void openCapture(cameraVideoRef.current)}
                  >
                    <Video className="size-4" />
                    {t("chat.recordVideo")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted"
                    onClick={() => {
                      setAttachOpen(false);
                      fileRef.current?.click();
                    }}
                  >
                    <FileUp className="size-4" />
                    {t("chat.attachFile")}
                  </button>
                </PopoverContent>
              </Popover>
              <input
                ref={galleryRef}
                type="file"
                accept={SUPPORT_CHAT_ACCEPT_MEDIA}
                className="hidden"
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <input
                ref={cameraPhotoRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <input
                ref={cameraVideoRef}
                type="file"
                accept="video/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <input
                ref={fileRef}
                type="file"
                accept={SUPPORT_CHAT_ACCEPT_FILES}
                className="hidden"
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("chat.typePlaceholder")}
                className="h-11 rounded-full"
                maxLength={4000}
                autoComplete="off"
                enterKeyHint="send"
                onFocus={(e) => {
                  e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="size-11 shrink-0 rounded-full"
                disabled={!canSend}
                aria-label={t("chat.send")}
              >
                <Send className="size-4" />
              </Button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
