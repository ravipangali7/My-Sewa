/** Vendored from jsqr@1.4.0 (Apache-2.0). See jsqr.LICENSE. */
declare function jsQR(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst";
  },
): { data: string } | null;

export default jsQR;
