import { useMemo } from "react";
import {
  getMySewaQrIdentity,
  mySewaQrImageSrc,
  mySewaQrPayload,
  type MySewaQrPerson,
} from "@/lib/my-qr-card";
import { cn } from "@/lib/utils";

export function MySewaQrCard({
  person,
  logoUrl,
  hint,
  fallbackName = "User",
  loadingLabel = "Loading",
  className,
  qrClassName,
}: {
  person: MySewaQrPerson;
  logoUrl?: string | null;
  hint: string;
  fallbackName?: string;
  loadingLabel?: string;
  className?: string;
  qrClassName?: string;
}) {
  const phone = person.phone;
  const firstName = person.first_name;
  const lastName = person.last_name;
  const nickname = person.nickname;

  const identity = useMemo(
    () =>
      getMySewaQrIdentity(
        { phone, first_name: firstName, last_name: lastName, nickname },
        fallbackName,
      ),
    [phone, firstName, lastName, nickname, fallbackName],
  );
  const qrSrc = useMemo(
    () =>
      mySewaQrImageSrc(
        mySewaQrPayload(
          { phone, first_name: firstName, last_name: lastName, nickname },
          fallbackName,
        ),
      ),
    [phone, firstName, lastName, nickname, fallbackName],
  );
  const logoSrc = logoUrl || "/logo.png";
  const qrSizeClass = qrClassName || "size-[min(48vw,13.5rem)]";

  return (
    <div className={cn("flex flex-col items-center justify-center gap-2.5 bg-white", className)}>
      {qrSrc ? (
        <img src={qrSrc} alt="Mysewa QR" className={cn("bg-white", qrSizeClass)} />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center bg-muted text-sm text-muted-foreground",
            qrSizeClass,
          )}
        >
          {loadingLabel}
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
        <p className="text-[17px] font-semibold text-zinc-800">{identity.displayName}</p>
        {identity.username ? (
          <p className="mt-0.5 text-[13px] font-medium text-zinc-500">{identity.username}</p>
        ) : null}
        <p className="mt-0.5 text-[14px] text-zinc-500">{identity.phone}</p>
        <p className="mt-2 text-[12px] text-zinc-400">{hint}</p>
      </div>
    </div>
  );
}
