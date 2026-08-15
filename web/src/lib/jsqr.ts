// Vendored (Apache-2.0) so builds don't depend on npm resolving `jsqr`.
import jsQRModule from "./vendor/jsqr.cjs";

/** CJS/UMD interop — bundlers may expose the function on `.default`. */
const jsQR =
  (jsQRModule as unknown as { default?: typeof jsQRModule }).default ?? jsQRModule;

export default jsQR;
