import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type BackButtonProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  to: any;
  params?: Record<string, string>;
  label?: string;
  className?: string;
};

export function BackButton({ to, params, label = "Back", className }: BackButtonProps) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => {
        // Flexible helper used across admin routes with different param shapes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void navigate({ to, params } as any);
      }}
      className={cn(
        "group inline-flex w-fit items-center gap-2.5 rounded-xl border border-border/80 bg-surface px-2.5 py-1.5 text-sm font-medium text-foreground shadow-sm transition-all duration-200",
        "hover:border-brand/35 hover:bg-brand-soft hover:text-brand-dark hover:shadow-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        className,
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground transition-colors duration-200 group-hover:bg-surface group-hover:text-brand-dark">
        <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
      </span>
      <span>{label}</span>
    </button>
  );
}
