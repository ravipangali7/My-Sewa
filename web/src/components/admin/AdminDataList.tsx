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
        <div className="rounded-md border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-xs text-slate-500 shadow-2xs">
          No records found.
        </div>
      )
    );
  }

  return (
    <>
      <div className="hidden min-w-0 overflow-x-auto rounded-md border border-slate-200 bg-white shadow-2xs lg:block">
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
        "w-full min-w-0 rounded-md border border-slate-200 bg-white p-3.5 text-left shadow-2xs transition-all",
        onClick && "cursor-pointer hover:border-slate-300 active:bg-slate-50",
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
  return <div className={cn("grid min-w-0 gap-2.5", className)}>{children}</div>;
}

export function AdminMobileMeta({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            {item.label}
          </dt>
          <dd className="mt-0.5 break-words text-xs font-medium text-slate-800 [overflow-wrap:anywhere]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-xs text-slate-500 shadow-2xs">
      {children}
    </div>
  );
}
