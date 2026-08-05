import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Desktop table + mobile/tablet card list — avoids cramped columns below lg. */
export function AdminDataList({
  table,
  mobile,
  empty,
  isEmpty,
}: {
  table: ReactNode;
  mobile: ReactNode;
  empty?: ReactNode;
  isEmpty?: boolean;
}) {
  if (isEmpty) {
    return (
      empty ?? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
          No items found.
        </div>
      )
    );
  }

  return (
    <>
      <div className="hidden min-w-0 overflow-x-auto rounded-xl border border-border bg-surface lg:block">
        {table}
      </div>
      <div className="min-w-0 lg:hidden">{mobile}</div>
    </>
  );
}

export function AdminMobileCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "w-full min-w-0 rounded-xl border border-border bg-surface p-4 text-left shadow-sm",
        onClick && "cursor-pointer transition-colors active:bg-muted/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AdminMobileCardGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("grid min-w-0 gap-3", className)}>{children}</div>;
}

export function AdminMobileMeta({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {item.label}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-foreground [overflow-wrap:anywhere]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
