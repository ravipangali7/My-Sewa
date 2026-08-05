import type { KycDocumentSide, KycDocumentType } from "@/lib/types";

/** Types that require both Front and Back images. */
export const DUAL_SIDE_DOCUMENT_TYPES: ReadonlySet<KycDocumentType> = new Set([
  "citizenship",
  "driving_license",
  "national_id",
]);

export function requiresBothSides(type: KycDocumentType): boolean {
  return DUAL_SIDE_DOCUMENT_TYPES.has(type);
}

/** Passport / Other: single-side (or front-only) is enough. */
export function singleSideForType(type: KycDocumentType): KycDocumentSide {
  return requiresBothSides(type) ? "front" : "single";
}

export type DocSideFiles = {
  front?: File | null;
  back?: File | null;
  single?: File | null;
};

export type DocFileMap = Partial<Record<KycDocumentType, DocSideFiles>>;

/** Flatten selected files into API multipart rows (file + document_type + side). */
export function flattenDocFiles(
  files: DocFileMap,
): Array<{ type: KycDocumentType; side: KycDocumentSide; file: File }> {
  const rows: Array<{ type: KycDocumentType; side: KycDocumentSide; file: File }> = [];
  for (const [type, sides] of Object.entries(files) as Array<
    [KycDocumentType, DocSideFiles | undefined]
  >) {
    if (!sides) continue;
    if (requiresBothSides(type)) {
      if (sides.front) rows.push({ type, side: "front", file: sides.front });
      if (sides.back) rows.push({ type, side: "back", file: sides.back });
    } else if (sides.single) {
      rows.push({ type, side: "single", file: sides.single });
    } else if (sides.front) {
      rows.push({ type, side: "front", file: sides.front });
    }
  }
  return rows;
}

/**
 * Client-side validation mirroring backend `validate_document_sides`.
 * Returns an i18n message key (or null when valid).
 */
export function validateDocSidesForSubmit(files: DocFileMap): string | null {
  const citizenship = files.citizenship;
  if (!citizenship?.front || !citizenship?.back) {
    return "kyc.citizenshipBothSidesRequired";
  }

  for (const type of DUAL_SIDE_DOCUMENT_TYPES) {
    if (type === "citizenship") continue;
    const slot = files[type];
    if (!slot) continue;
    const hasAny = Boolean(slot.front || slot.back);
    if (!hasAny) continue;
    if (!slot.front || !slot.back) {
      return "kyc.bothSidesRequired";
    }
  }

  return null;
}
