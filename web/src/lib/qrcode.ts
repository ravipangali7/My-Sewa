/**
 * Self-contained QR encoder (byte mode, ECC-M).
 * Vendored in-repo so production builds do not need the `qrcode` npm package.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const divisor = rsDivisor(ecLen);
  const result = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ result[0]!;
    result.copyWithin(0, 1);
    result[ecLen - 1] = 0;
    if (factor === 0) continue;
    for (let j = 0; j < ecLen; j++) {
      result[j]! ^= gfMul(divisor[j]!, factor);
    }
  }
  return Array.from(result);
}

/** ECC-M: [ecPerBlock, ...groups of [blockCount, dataPerBlock]] */
const EC_M: Array<{ ec: number; groups: Array<[number, number]> }> = [
  { ec: 0, groups: [] },
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
  { ec: 26, groups: [[4, 43], [1, 44]] },
  { ec: 30, groups: [[1, 50], [4, 51]] },
  { ec: 22, groups: [[6, 36], [2, 37]] },
  { ec: 22, groups: [[8, 37], [1, 38]] },
  { ec: 24, groups: [[4, 40], [5, 41]] },
  { ec: 24, groups: [[5, 41], [5, 42]] },
  { ec: 28, groups: [[7, 45], [3, 46]] },
  { ec: 28, groups: [[10, 47], [1, 48]] },
  { ec: 26, groups: [[9, 46], [4, 47]] },
  { ec: 26, groups: [[3, 44], [11, 45]] },
  { ec: 26, groups: [[3, 41], [13, 42]] },
];

const ALIGN: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
];

function dataCapacity(version: number): number {
  const spec = EC_M[version];
  if (!spec) return 0;
  let n = 0;
  for (const [blocks, data] of spec.groups) n += blocks * data;
  return n;
}

function remainderBits(version: number): number {
  if (version >= 2 && version <= 6) return 7;
  if (version >= 14 && version <= 20) return 3;
  if (version >= 21 && version <= 27) return 4;
  if (version >= 28 && version <= 34) return 3;
  if (version >= 35) return 4;
  return 0;
}

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 20; v++) {
    const header = 4 + countBits(v) + 4;
    const need = Math.ceil((header + byteLen * 8) / 8);
    if (need <= dataCapacity(v)) return v;
  }
  throw new Error("QR payload is too large");
}

function pushBits(bits: number[], value: number, len: number) {
  for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function bitsToBytes(bits: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ?? 0);
    bytes.push(b);
  }
  return bytes;
}

function buildDataBytes(payload: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, payload.length, countBits(version));
  for (const b of payload) pushBits(bits, b, 8);
  const capBits = dataCapacity(version) * 8;
  const term = Math.min(4, capBits - bits.length);
  pushBits(bits, 0, term);
  while (bits.length % 8 !== 0) bits.push(0);
  const pad = [0xec, 0x11];
  let pi = 0;
  while (bits.length < capBits) {
    pushBits(bits, pad[pi % 2]!, 8);
    pi++;
  }
  return bitsToBytes(bits.slice(0, capBits));
}

function interleave(version: number, data: number[]): number[] {
  const spec = EC_M[version]!;
  const blocks: Array<{ data: number[]; ecc: number[] }> = [];
  let offset = 0;
  for (const [count, dataLen] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const blockData = data.slice(offset, offset + dataLen);
      offset += dataLen;
      blocks.push({ data: blockData, ecc: rsEncode(blockData, spec.ec) });
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) {
      if (i < b.data.length) out.push(b.data[i]!);
    }
  }
  const maxEc = spec.ec;
  for (let i = 0; i < maxEc; i++) {
    for (const b of blocks) out.push(b.ecc[i]!);
  }
  return out;
}

function sizeOf(version: number): number {
  return 17 + 4 * version;
}

function inFinder(r: number, c: number, n: number): boolean {
  return (r < 9 && c < 9) || (r < 9 && c >= n - 8) || (r >= n - 8 && c < 9);
}

function setModule(
  grid: number[][],
  reserved: boolean[][],
  r: number,
  c: number,
  dark: boolean,
) {
  if (r < 0 || c < 0 || r >= grid.length || c >= grid.length) return;
  grid[r]![c] = dark ? 1 : 0;
  reserved[r]![c] = true;
}

function drawFinder(grid: number[][], reserved: boolean[][], r0: number, c0: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = r0 + r;
      const cc = c0 + c;
      const dark =
        r >= 0 && r <= 6 && c >= 0 && c <= 6
          ? r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          : false;
      setModule(grid, reserved, rr, cc, dark);
    }
  }
}

function drawAlignment(grid: number[][], reserved: boolean[][], version: number) {
  const n = grid.length;
  const pos = ALIGN[version] ?? [];
  for (const r of pos) {
    for (const c of pos) {
      if (inFinder(r, c, n)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(grid, reserved, r + dr, c + dc, dark);
        }
      }
    }
  }
}

function drawTimingAndDark(grid: number[][], reserved: boolean[][]) {
  const n = grid.length;
  for (let i = 0; i < n; i++) {
    if (!reserved[6]![i]) setModule(grid, reserved, 6, i, i % 2 === 0);
    if (!reserved[i]![6]) setModule(grid, reserved, i, 6, i % 2 === 0);
  }
  setModule(grid, reserved, n - 8, 8, true);
}

function formatBits(mask: number): number {
  const data = mask & 7;
  let d = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((d >>> i) & 1) d ^= 0x537 << (i - 10);
  }
  return ((data << 10) | d) ^ 0x5412;
}

function versionBits(version: number): number {
  let d = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((d >>> i) & 1) d ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | d;
}

function drawFormat(grid: number[][], reserved: boolean[][], mask: number) {
  const n = grid.length;
  const bits = formatBits(mask);
  const put = (r: number, c: number, i: number) => {
    setModule(grid, reserved, r, c, ((bits >>> i) & 1) === 1);
  };
  for (let i = 0; i <= 5; i++) put(i, 8, i);
  put(7, 8, 6);
  put(8, 8, 7);
  put(8, 7, 8);
  for (let i = 9; i < 15; i++) put(8, 14 - i, i);
  for (let i = 0; i < 8; i++) put(8, n - 1 - i, i);
  for (let i = 8; i < 15; i++) put(n - 15 + i, 8, i);
}

function drawVersion(grid: number[][], reserved: boolean[][], version: number) {
  if (version < 7) return;
  const n = grid.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    setModule(grid, reserved, r, n - 11 + c, dark);
    setModule(grid, reserved, n - 11 + c, r, dark);
  }
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function placeData(
  grid: number[][],
  reserved: boolean[][],
  dataBits: number[],
) {
  const n = grid.length;
  let bi = 0;
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = upward ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (c < 0 || reserved[r]![c]) continue;
        const bit = dataBits[bi++] ?? 0;
        grid[r]![c] = bit;
      }
    }
    upward = !upward;
  }
}

function applyMask(grid: number[][], reserved: boolean[][], mask: number): number[][] {
  const n = grid.length;
  const out = grid.map((row) => row.slice());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (reserved[r]![c]) continue;
      if (maskFn(mask, r, c)) out[r]![c] = out[r]![c] ? 0 : 1;
    }
  }
  return out;
}

function penalty(grid: number[][]): number {
  const n = grid.length;
  let score = 0;
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c <= n; c++) {
      if (c < n && grid[r]![c] === grid[r]![c - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r <= n; r++) {
      if (r < n && grid[r]![c] === grid[r - 1]![c]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r]![c];
      if (v === grid[r]![c + 1] && v === grid[r + 1]![c] && v === grid[r + 1]![c + 1]) {
        score += 3;
      }
    }
  }
  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (grid[r]![c]) dark++;
  }
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

function encodeModules(text: string): number[][] {
  const payload = new TextEncoder().encode(text);
  const version = pickVersion(payload.length);
  const n = sizeOf(version);
  const dataBytes = interleave(version, buildDataBytes(payload, version));
  const dataBits: number[] = [];
  for (const b of dataBytes) pushBits(dataBits, b, 8);
  for (let i = 0; i < remainderBits(version); i++) dataBits.push(0);

  const grid = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const reserved = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  drawFinder(grid, reserved, 0, 0);
  drawFinder(grid, reserved, 0, n - 7);
  drawFinder(grid, reserved, n - 7, 0);
  drawAlignment(grid, reserved, version);
  drawTimingAndDark(grid, reserved);
  drawFormat(grid, reserved, 0);
  drawVersion(grid, reserved, version);
  placeData(grid, reserved, dataBits);

  let best = grid;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(grid, reserved, mask);
    drawFormat(masked, reserved, mask);
    drawVersion(masked, reserved, version);
    const score = penalty(masked);
    if (score < bestScore) {
      bestScore = score;
      best = masked;
    }
  }
  return best;
}

function toSvgDataUrl(modules: number[][], size: number, dark: string, light: string): string {
  const n = modules.length;
  const quiet = 2;
  const dim = n + quiet * 2;
  const cell = size / dim;
  let rects = `<rect width="${size}" height="${size}" fill="${light}"/>`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules[r]![c]) continue;
      const x = (c + quiet) * cell;
      const y = (r + quiet) * cell;
      rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${dark}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rects}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function toCanvasDataUrl(modules: number[][], size: number, dark: string, light: string): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const n = modules.length;
  const quiet = 2;
  const dim = n + quiet * 2;
  const cell = size / dim;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules[r]![c]) continue;
      ctx.fillRect(
        Math.floor((c + quiet) * cell),
        Math.floor((r + quiet) * cell),
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
  }
  return canvas.toDataURL("image/png");
}

/** Encode `text` as a QR image data URL (PNG when canvas exists, otherwise SVG). */
export function toDataURL(
  text: string,
  options?: { width?: number; color?: { dark?: string; light?: string } },
): string {
  const size = options?.width ?? 512;
  const dark = options?.color?.dark ?? "#1C1C1E";
  const light = options?.color?.light ?? "#FFFFFF";
  const modules = encodeModules(text);
  return toCanvasDataUrl(modules, size, dark, light) ?? toSvgDataUrl(modules, size, dark, light);
}

export default { toDataURL };
