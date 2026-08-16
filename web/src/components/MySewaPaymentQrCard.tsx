import { cn } from "@/lib/utils";

type MySewaPaymentQrCardProps = {
  qrSrc: string;
  logoUrl: string;
  name: string;
  username?: string;
  phone: string;
  hint: string;
  qrAlt?: string;
  emptyLabel?: string;
  className?: string;
};

/**
 * On-screen Mysewa payment QR (logo, name, username, phone). Used by the
 * customer Scan sheet and Super Admin user details — keep them identical.
 */
export function MySewaPaymentQrCard({
  qrSrc,
  logoUrl,
  name,
  username,
  phone,
  hint,
  qrAlt = "My QR",
  emptyLabel = "…",
  className,
}: MySewaPaymentQrCardProps) {
  const logoSrc = logoUrl || "/logo.png";

  return (
    <div className={cn("flex flex-col items-center justify-center gap-2.5 bg-white px-6 py-3", className)}>
      {qrSrc ? (
        <img src={qrSrc} alt={qrAlt} className="size-[min(48vw,13.5rem)] bg-white" />
      ) : (
        <div className="flex size-[min(48vw,13.5rem)] items-center justify-center bg-muted text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
      <div className="flex items-center gap-2">
        <img
          src={logoSrc}
          alt="Mysewa"
          className="size-7 rounded-full object-cover"
          onError={(event) => {
            event.currentTarget.src = "/logo.png";
          }}
        />
        <span className="text-[18px] font-bold leading-none">
          <span className="text-ocean">My</span>
          <span className="text-brand">sewa</span>
        </span>
      </div>
      <div className="text-center">
        <p className="text-[17px] font-semibold text-zinc-800">{name}</p>
        {username ? (
          <p className="mt-0.5 text-[13px] font-medium text-zinc-500">{username}</p>
        ) : null}
        <p className="mt-0.5 text-[14px] text-zinc-500">{phone}</p>
        <p className="mt-2 text-[12px] text-zinc-400">{hint}</p>
      </div>
    </div>
  );
}
