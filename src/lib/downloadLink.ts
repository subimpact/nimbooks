// Real-HTTPS-download escape hatch for super-app WebViews.
//
// Nimiq Pay's WebView has no download listener, so anchor-download and
// window.open(data:) both dead-end (verified on device). A plain HTTPS link
// opened in the system browser does work, because Chrome honours the
// Content-Disposition header the /export Pages Function sets.
//
// The CSV is gzipped and base64url'd into the query string, so the Function
// stays stateless — nothing about the user's ledger is ever stored server-side.
//
// The short form of the same link (buildShortExportLink) trades that for a URL
// a QR code can carry: the payload is parked in our own Workers KV for 48h and
// served from /s/<slug>.csv. Same origin, same code, no third party — which is
// why export links are not sent to /api/shorten.

/** 16 KB URL cap minus path/query overhead — must match functions/export. */
const MAX_PAYLOAD = 12000

/** Long enough for a cold Function start plus a KV write on a phone's
 *  connection, short enough that the modal is not left waiting on it. */
const TIMEOUT_MS = 8000

/**
 * gzip + base64url the CSV, the form both /export/ and /api/export-link take.
 * Returns null when gzip is unavailable or the result is too large for a URL
 * (full histories run ~200 KB).
 */
async function buildPayload(csv: string): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const compressed = blob.stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer())
  // Chunked so long CSVs don't blow the argument limit on String.fromCharCode.
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return b64.length > MAX_PAYLOAD ? null : b64
}

/**
 * Build a real HTTPS download link for a CSV.
 * Returns null when gzip is unavailable or the payload is too large for a URL
 * (full histories run ~200 KB) — callers fall back to clipboard.
 */
export async function buildDownloadLink(csv: string, filename: string): Promise<string | null> {
  const b64 = await buildPayload(csv)
  if (!b64) return null
  return `${window.location.origin}/export/${encodeURIComponent(filename)}?d=${b64}`
}

export type ShortExportLink = { ok: true; url: string } | { ok: false }

/**
 * Ask our own edge for the short form of that link.
 *
 * Never throws: offline, endpoint missing, KV binding not yet bound, slow,
 * malformed response — every one of them resolves to { ok: false } and the
 * caller shows the long link instead, which downloads exactly the same file.
 */
export async function buildShortExportLink(
  csv: string,
  filename: string,
): Promise<ShortExportLink> {
  try {
    const d = await buildPayload(csv)
    if (!d) return { ok: false }
    const res = await fetch('/api/export-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ d, name: filename }),
      signal: timeoutSignal(TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { url?: unknown }
    return typeof data?.url === 'string' && data.url ? { ok: true, url: data.url } : { ok: false }
  } catch {
    return { ok: false }
  }
}

/** AbortSignal.timeout where it exists, a controller plus a timer where it does
 *  not. Anything old enough to have neither cannot have reached this function:
 *  buildPayload needs CompressionStream, which every engine shipped long after
 *  AbortController. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  if (typeof AbortController === 'undefined') return undefined
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}
