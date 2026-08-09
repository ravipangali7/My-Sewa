import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { HomePopup } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/popups")({
  head: () => ({
    meta: [
      { title: "Home Popups — MySewa Admin" },
      {
        name: "description",
        content:
          "Create and manage home-screen popups with per-user display limits over 24 hours.",
      },
      { property: "og:title", content: "Home Popups — MySewa Admin" },
    ],
  }),
  component: PopupsPage,
});

type FormState = {
  title: string;
  body: string;
  max_per_24h: string;
  is_active: boolean;
  sort_order: string;
  imageFile: File | null;
  clearImage: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  max_per_24h: "1",
  is_active: true,
  sort_order: "0",
  imageFile: null,
  clearImage: false,
};

function formFromPopup(popup: HomePopup): FormState {
  return {
    title: popup.title || "",
    body: popup.body || "",
    max_per_24h: String(popup.max_per_24h || 1),
    is_active: popup.is_active,
    sort_order: String(popup.sort_order ?? 0),
    imageFile: null,
    clearImage: false,
  };
}

function buildPayload(form: FormState): FormData {
  const fd = new FormData();
  fd.append("title", form.title.trim());
  fd.append("body", form.body.trim());
  fd.append("max_per_24h", String(Math.max(1, Number(form.max_per_24h) || 1)));
  fd.append("is_active", form.is_active ? "true" : "false");
  fd.append("sort_order", String(Number(form.sort_order) || 0));
  if (form.imageFile) fd.append("image", form.imageFile);
  if (form.clearImage) fd.append("clear_image", "true");
  return fd;
}

function PopupsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HomePopup | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HomePopup | null>(null);

  const popupsQuery = useQuery({
    queryKey: ["admin", "popups", statusFilter],
    queryFn: () =>
      apiClient.adminPopups(
        statusFilter === "all"
          ? undefined
          : { is_active: statusFilter === "active" ? "true" : "false" },
      ),
    refetchOnMount: "always",
  });

  const items = popupsQuery.data?.items ?? [];

  useEffect(() => {
    if (!form.imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(form.imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [form.imageFile]);

  const existingImageUrl = useMemo(() => {
    if (form.clearImage) return null;
    if (previewUrl) return previewUrl;
    return editing?.image_url ?? null;
  }, [editing?.image_url, form.clearImage, previewUrl]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload(form);
      if (editing) return apiClient.adminUpdatePopup(editing.id, payload);
      return apiClient.adminCreatePopup(payload);
    },
    onSuccess: (res) => {
      toast.success(res.message || (editing ? "Popup updated" : "Popup created"));
      setEditorOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      queryClient.invalidateQueries({ queryKey: ["admin", "popups"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to save popup");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminDeletePopup(id),
    onSuccess: () => {
      toast.success("Popup deleted");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "popups"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete popup");
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (popup: HomePopup) => {
    setEditing(popup);
    setForm(formFromPopup(popup));
    setEditorOpen(true);
  };

  const canSave =
    Boolean(form.title.trim() || form.body.trim() || form.imageFile || (existingImageUrl && !form.clearImage));

  return (
    <AdminShell title="Home Popups" description="Show promotional messages on the user home screen">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="h-9 w-full sm:w-[180px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All popups</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          Create popup
        </Button>
      </div>

      {popupsQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading popups…</p>
      )}
      {popupsQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {popupsQuery.error instanceof ApiError
            ? popupsQuery.error.message
            : "Could not load popups."}
        </p>
      )}

      <AdminDataList
        isEmpty={!popupsQuery.isLoading && items.length === 0}
        empty={
          <AdminEmptyState>
            <p className="mb-3">No popups yet. Create a text and/or image popup for the home page.</p>
            <Button type="button" onClick={openCreate} className="gap-1.5">
              <Plus className="size-4" />
              Create popup
            </Button>
          </AdminEmptyState>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((popup) => (
              <AdminMobileCard key={popup.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {popup.title?.trim() || `Popup #${popup.id}`}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {popup.body?.trim() || "Image-only popup"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openEdit(popup)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => setDeleteTarget(popup)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <AdminMobileMeta
                  items={[
                    { label: "Status", value: popup.is_active ? "Active" : "Inactive" },
                    { label: "Times / 24h", value: String(popup.max_per_24h) },
                    { label: "Order", value: String(popup.sort_order) },
                    { label: "Updated", value: formatDateTime(popup.updated_at) },
                  ]}
                />
                {popup.image_url ? (
                  <img
                    src={popup.image_url}
                    alt=""
                    className="mt-3 max-h-28 w-full rounded-md object-cover"
                  />
                ) : null}
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preview</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Times / 24h</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((popup) => (
                <TableRow key={popup.id}>
                  <TableCell>
                    {popup.image_url ? (
                      <img
                        src={popup.image_url}
                        alt=""
                        className="size-12 rounded object-cover"
                      />
                    ) : (
                      <div className="flex size-12 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                        Text
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <p className="truncate font-medium">
                      {popup.title?.trim() || `Popup #${popup.id}`}
                    </p>
                    {popup.body?.trim() ? (
                      <p className="truncate text-sm text-muted-foreground">{popup.body}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>{popup.max_per_24h}</TableCell>
                  <TableCell>{popup.sort_order}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        popup.is_active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {popup.is_active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(popup.updated_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => openEdit(popup)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => setDeleteTarget(popup)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
      />

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditing(null);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit popup" : "Create popup"}</DialogTitle>
            <DialogDescription>
              Add text, an image, or both. Each user can see it at most the configured times
              within any 24-hour period.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="popup-title">Title</Label>
              <Input
                id="popup-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Optional headline"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="popup-body">Message</Label>
              <Textarea
                id="popup-body"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Optional body text"
                rows={4}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="popup-image">Image</Label>
              <Input
                id="popup-image"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setForm((f) => ({ ...f, imageFile: file, clearImage: false }));
                }}
              />
              {existingImageUrl ? (
                <div className="relative overflow-hidden rounded-md border">
                  <img src={existingImageUrl} alt="" className="max-h-48 w-full object-contain" />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="absolute right-2 top-2"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        imageFile: null,
                        clearImage: true,
                      }))
                    }
                  >
                    Remove image
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="popup-max">Times per 24 hours</Label>
                <Input
                  id="popup-max"
                  type="number"
                  min={1}
                  value={form.max_per_24h}
                  onChange={(e) => setForm((f) => ({ ...f, max_per_24h: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="popup-order">Sort order</Label>
                <Input
                  id="popup-order"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Show on user home when eligible</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this popup?</AlertDialogTitle>
            <AlertDialogDescription>
              Users will stop seeing it immediately. Impression history for this popup will also
              be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
