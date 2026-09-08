// Minimal QR Code encoder — byte mode, ECC levels L/M, versions 1–40.
// Hand-rolled (~200 lines) so invoices get a scannable code without adding a
// dependency to a bundle that is already near its size budget.
// Implements ISO/IEC 18004: RS error correction over GF(2^8), function
// patterns, all 8 data masks with the standard penalty scoring.

export type Ecl = 'L' | 'M'

// Table index = version (0 is padding — versions start at 1).
const ECC_CODEWORDS_PER_BLOCK: Record<Ecl, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
}

const NUM_EC_BLOCKS: Record<Ecl, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
}

const ECL_FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0 }

// --- GF(2^8) arithmetic (primitive polynomial 0x11D) ---

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

// --- Capacity helpers ---

function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return []
  const numAlign = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = version * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return result
}

function numDataCodewords(version: number, ecl: Ecl): number {
  return (
    Math.floor(numRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_EC_BLOCKS[ecl][version]
  )
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0
}

// --- Encoder ---

export interface QrResult {
  size: number
  modules: boolean[][] // [y][x], true = dark
  version: number
}

/**
 * Encode `text` (UTF-8, byte mode) into a QR matrix.
 * Throws when the text does not fit in a version-40 symbol.
 */
export function encodeQr(text: string, ecl: Ecl = 'M'): QrResult {
  const bytes = Array.from(new TextEncoder().encode(text))

  let version = 0
  for (let v = 1; v <= 40; v++) {
    const charCountBits = v < 10 ? 8 : 16
    const needed = 4 + charCountBits + 8 * bytes.length
    if (needed <= numDataCodewords(v, ecl) * 8) {
      version = v
      break
    }
  }
  if (version === 0) throw new Error('Data too long for a QR code')

  // Bit stream: mode indicator + character count + payload
  const bits: number[] = []
  const appendBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  appendBits(0b0100, 4) // byte mode
  appendBits(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) appendBits(b, 8)

  const capacityBits = numDataCodewords(version, ecl) * 8
  appendBits(0, Math.min(4, capacityBits - bits.length)) // terminator
  appendBits(0, (8 - (bits.length % 8)) % 8) // byte align
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8)

  const dataCodewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    dataCodewords.push(byte)
  }

  const codewords = interleaveBlocks(dataCodewords, version, ecl)
  return drawSymbol(codewords, version, ecl)
}

function interleaveBlocks(data: number[], version: number, ecl: Ecl): number[] {
  const numBlocks = NUM_EC_BLOCKS[ecl][version]
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version]
  const rawCodewords = Math.floor(numRawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)

  const divisor = rsDivisor(blockEccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
    const dat = data.slice(k, k + len)
    k += len
    const ecc = rsRemainder(dat, divisor)
    // Short blocks get a placeholder so column indices line up while interleaving.
    if (i < numShortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }

  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i])
    }
  }
  return result
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function drawSymbol(codewords: number[], version: number, ecl: Ecl): QrResult {
  const size = version * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))

  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    isFunction[y][x] = true
  }

  // Timing patterns
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0)
    setFn(i, 6, i % 2 === 0)
  }

  // Finder patterns + separators
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4)
      }
    }
  }

  // Alignment patterns (skip the three finder corners)
  const alignPos = alignmentPatternPositions(version)
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === alignPos.length - 1) ||
        (i === alignPos.length - 1 && j === 0)
      )
        continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(alignPos[j] + dx, alignPos[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  // Version information (versions 7+)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i)
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFn(a, b, bit)
      setFn(b, a, bit)
    }
  }

  // Reserve the format-info area so codeword placement skips it.
  drawFormatBits(setFn, size, ecl, 0)

  // Data codewords, zigzagging upward from the bottom-right (skip column 6).
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = getBit(codewords[i >>> 3], 7 - (i & 7))
          i++
        }
      }
    }
  }

  // Pick the mask with the lowest penalty score.
  let bestMask = 0
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFunction, mask)
    drawFormatBits(setFn, size, ecl, mask)
    const penalty = penaltyScore(modules, size)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMask = mask
    }
    applyMask(modules, isFunction, mask) // XOR again to undo
  }
  applyMask(modules, isFunction, bestMask)
  drawFormatBits(setFn, size, ecl, bestMask)

  return { size, modules, version }
}

function drawFormatBits(
  setFn: (x: number, y: number, dark: boolean) => void,
  size: number,
  ecl: Ecl,
  mask: number
) {
  const data = (ECL_FORMAT_BITS[ecl] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff

  for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i))
  setFn(8, 7, getBit(bits, 6))
  setFn(8, 8, getBit(bits, 7))
  setFn(7, 8, getBit(bits, 8))
  for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i))

  for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i))
  for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i))
  setFn(8, size - 8, true) // always-dark module
}

function applyMask(modules: boolean[][], isFunction: boolean[][], mask: number) {
  const fn = MASKS[mask]
  for (let y = 0; y < modules.length; y++) {
    for (let x = 0; x < modules.length; x++) {
      if (!isFunction[y][x] && fn(x, y)) modules[y][x] = !modules[y][x]
    }
  }
}

function penaltyScore(modules: boolean[][], size: number): number {
  let result = 0

  // Rule 1: runs of 5+ same-colour modules in a row/column.
  const runPenalty = (runLen: number) => (runLen >= 5 ? 3 + (runLen - 5) : 0)
  for (let y = 0; y < size; y++) {
    let run = 1
    for (let x = 1; x < size; x++) {
      if (modules[y][x] === modules[y][x - 1]) run++
      else {
        result += runPenalty(run)
        run = 1
      }
    }
    result += runPenalty(run)
  }
  for (let x = 0; x < size; x++) {
    let run = 1
    for (let y = 1; y < size; y++) {
      if (modules[y][x] === modules[y - 1][x]) run++
      else {
        result += runPenalty(run)
        run = 1
      }
    }
    result += runPenalty(run)
  }

  // Rule 2: 2×2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x]
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3
    }
  }

  // Rule 3: finder-like patterns (1011101 with 4 light modules on either side).
  const P = [true, false, true, true, true, false, true]
  const LIGHT4 = [false, false, false, false]
  const matches = (get: (i: number) => boolean, start: number, pattern: boolean[]) => {
    for (let i = 0; i < pattern.length; i++) if (get(start + i) !== pattern[i]) return false
    return true
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x + 7 <= size; x++) {
      const get = (i: number) => modules[y][i]
      if (!matches(get, x, P)) continue
      const before = x - 4 >= 0 && matches(get, x - 4, LIGHT4)
      const after = x + 11 <= size && matches(get, x + 7, LIGHT4)
      if (before || after) result += 40
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y + 7 <= size; y++) {
      const get = (i: number) => modules[i][x]
      if (!matches(get, y, P)) continue
      const before = y - 4 >= 0 && matches(get, y - 4, LIGHT4)
      const after = y + 11 <= size && matches(get, y + 7, LIGHT4)
      if (before || after) result += 40
    }
  }

  // Rule 4: deviation from a 50/50 dark ratio.
  let dark = 0
  for (const row of modules) for (const cell of row) if (cell) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  result += k * 10

  return result
}

/**
 * SVG path data for the dark modules — one `M x y h w v h h -w z` per run,
 * which keeps the DOM to a single <path> element even for version-20 codes.
 */
export function qrPathData(qr: QrResult): string {
  const parts: string[] = []
  for (let y = 0; y < qr.size; y++) {
    let x = 0
    while (x < qr.size) {
      if (!qr.modules[y][x]) {
        x++
        continue
      }
      let run = 1
      while (x + run < qr.size && qr.modules[y][x + run]) run++
      parts.push(`M${x} ${y}h${run}v1h-${run}z`)
      x += run
    }
  }
  return parts.join('')
}
