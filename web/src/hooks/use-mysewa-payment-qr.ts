import { useMemo } from "react";
import { buildMySewaAccountQr } from "@/lib/bank-qr";
import { mySewaQrIdentity, type MySewaQrUser } from "@/lib/my-qr-card";
import { toDataURL } from "@/lib/qrcode";

const QR_RENDER = { width: 640, color: { dark: "#1C1C1E", light: "#FFFFFF" } } as const;

/**
 * Encode and rasterize the same personal payment QR used in the Mysewa app
 * and on Super Admin user details.
 */
export function useMySewaPaymentQr(
  user: MySewaQrUser | null | undefined,
  fallbackName = "",
) {
  const firstName = user?.first_name ?? "";
  const lastName = user?.last_name ?? "";
  const nickname = user?.nickname ?? "";
  const phone = user?.phone ?? "";

  const identity = useMemo(
    () =>
      mySewaQrIdentity(
        { first_name: firstName, last_name: lastName, nickname, phone },
        fallbackName,
      ),
    [firstName, lastName, nickname, phone, fallbackName],
  );

  const qrPayload = useMemo(() => {
    if (!identity.phone) return "";
    return buildMySewaAccountQr({
      accountName: identity.payloadName,
      accountNumber: identity.phone,
    });
  }, [identity.payloadName, identity.phone]);

  const qrSrc = useMemo(() => {
    if (!qrPayload) return "";
    try {
      return toDataURL(qrPayload, QR_RENDER);
    } catch {
      return "";
    }
  }, [qrPayload]);

  return { ...identity, qrPayload, qrSrc };
}
