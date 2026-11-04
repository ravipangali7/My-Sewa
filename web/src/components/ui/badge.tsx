import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold tracking-wide transition-colors focus:outline-none focus:ring-1 focus:ring-ring",
  {
    variants: {
      variant: {
        default: "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-2xs hover:bg-emerald-100/80",
        secondary:
          "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
        destructive:
          "border-red-200 bg-red-50 text-red-700 shadow-2xs hover:bg-red-100",
        outline: "border-slate-300 text-slate-700 bg-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
