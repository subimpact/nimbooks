// Shared plumbing for the two routes that hand a CSV back as a file download:
// /export/<name>.csv?d=<payload> (stateless, payload in the URL) and
// /s/<slug>.csv (the same payload, parked in KV for 48h so the link stays
// short enough to scan). Both decode the identical base64url(gzip(CSV)) blob
// and both answer with the identical attachment headers, so the decoding, the
// filename cleanup and the response live here rather than in two copies.
//
// Files under functions/_lib are never routed by Pages, so this is a module,
// not an endpoint.

/** 16 KB URL cap minus path/query overhead, with a safety margin. */
export const MAX_PAYLOAD = 12000

/** Gzip expands: 12 KB of base64 can unpack to hundreds of megabytes if someone
 *  hand-rolls a compression bomb. A real NimBooks export is a few hundred KB of
 *  CSV at most, so stop reading well before a bomb can hold an edge worker's
 *  memory. Counted on the decompressed side, since that is the side that grows. */
export const MAX_DECOMPRESSED = 1024 * 1024

export type DecodedPayload =
  | { ok: true; body: Uint8Array }
  | { ok: false; reason: 'malformed' | 'too-large' }

/** Header-safe, path-traversal-safe filename. */
export function safeName(raw: string): string {
  const base = raw.split('/').pop() ?? ''
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100)
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'nimbooks.csv'
  return cleaned.endsWith('.csv') ? cleaned : cleaned + '.csv'
}

/** base64url(gzip(CSV)) → the CSV bytes.
 *
 *  Bytes, never a string: the CSV opens with a UTF-8 BOM (Excel needs it) and
 *  Response.text() performs a spec UTF-8 decode, which strips a leading BOM.
 *  Buffered rather than streamed so a corrupt payload fails here — as a 400 —
 *  instead of truncating a body already committed to a 200. Read chunk by chunk
 *  rather than via Response.arrayBuffer() so MAX_DECOMPRESSED can actually stop
 *  a bomb mid-flight instead of measuring it once it has already been held. */
export async function decodeExportPayload(payload: string): Promise<DecodedPayload> {
  let stream: ReadableStream<Uint8Array>
  try {
    // base64url → bytes
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const bin = atob(b64 + pad)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_DECOMPRESSED) {
        await reader.cancel()
        return { ok: false, reason: 'too-large' }
      }
      chunks.push(value)
    }
  } catch {
    // A truncated or non-gzip payload surfaces here, at the first read.
    return { ok: false, reason: 'malformed' }
  }

  const body = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }

  // The decompressed bytes are only trustworthy if they look like a real
  // NimBooks CSV. Proving gzip alone would make this a bounded arbitrary-blob
  // host, so check the shape of the first non-empty line after any UTF-8 BOM:
  // it must carry a comma and one of the known header tokens. This runs here so
  // both the mint and /s/<slug>.csv share it.
  if (!looksLikeExportCsv(body)) return { ok: false, reason: 'malformed' }

  return { ok: true, body }
}

/** True when the first non-empty line (after a leading UTF-8 BOM) is a header
 *  carrying a comma and a known NimBooks token. Tolerant by design: it only
 *  needs a comma and one header keyword, so real exports pass untouched while
 *  arbitrary gzip blobs fail the shape check. */
function looksLikeExportCsv(body: Uint8Array): boolean {
  let offset = 0
  // Drop a leading UTF-8 BOM (EF BB BF) if present.
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) offset = 3

  const text = new TextDecoder('utf-8').decode(body.subarray(offset))
  for (const line of text.split('\n')) {
    if (!line.trim()) continue // empty or whitespace-only
    if (!line.includes(',')) return false
    return line.includes('txHash') || line.includes('receivedNIM')
  }
  return false
}

/** The CSV, as a file the browser saves rather than a page it renders. */
export function csvAttachment(body: Uint8Array, name: string): Response {
  return new Response(body, {
    headers: {
      // The CSV already carries a UTF-8 BOM from buildCsv() — Excel needs it.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
