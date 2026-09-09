import { cn } from "@/lib/utils";

type BiometricFingerprintButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  className?: string;
};

/** Banking-style circular fingerprint control matching Android BiometricPrompt. */
export function BiometricFingerprintButton({
  onClick,
  disabled = false,
  loading = false,
  label,
  className,
}: BiometricFingerprintButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      className={cn(
        "mx-auto flex size-[72px] items-center justify-center rounded-full",
        "bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06),0_10px_28px_-12px_rgba(26,115,232,0.45)]",
        "ring-1 ring-[#1A73E8]/12 transition-transform duration-150",
        "hover:ring-[#1A73E8]/25 active:scale-[0.96]",
        "disabled:pointer-events-none disabled:opacity-55",
        loading && "animate-pulse",
        className,
      )}
    >
      <FingerprintMark className="size-10" />
    </button>
  );
}

export function FingerprintMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("text-[#1A73E8]", className)}
    >
      <path
        d="M12 3.4c-2.2 0-4.1.84-5.5 2.18"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      <path
        d="M17.7 5.35C16.4 4.15 14.6 3.4 12.6 3.4"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      <path
        d="M7.15 8.2c.9-1.15 2.25-1.9 3.85-1.9 1.7 0 3.2.82 4.1 2.1"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      <path
        d="M5.6 11.05c.55-2.2 2.5-3.85 4.85-3.85 1.55 0 2.95.68 3.9 1.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M18.55 10.2c.45.9.7 1.95.7 3.05 0 2.55-.85 4.55-2.05 6.05"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8.2 19.35c-1.35-1.45-2.15-3.4-2.15-5.55 0-2.05 1.5-3.75 3.5-3.75 1.55 0 2.85 1.05 3.3 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M15.85 18.85c.7-1.15 1.1-2.5 1.1-4.05 0-1.85-1.35-3.35-3.15-3.35-.95 0-1.8.4-2.35 1.05"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12.2 12.55c.7.4 1.15 1.2 1.15 2.15 0 1.7-.55 3.15-1.35 4.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M10.05 14.35c0 1.55-.25 2.9-.7 4.05"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
