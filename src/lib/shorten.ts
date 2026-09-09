// Client half of the share-link shortener. The long URL carries the whole
// receipt in its fragment, which reads as a wall of base64 in a chat window;
// /api/shorten hands back a short.io link that points at the same thing.
//
// Never throws and never blocks sharing: any failure — offline, endpoint down,
// slow, malformed response — resolves to the original URL, which is a perfectly
// good share link on its own.

/** Long enough for a cold Function start, short enough not to stall the share
 *  sheet. Anything slower is not worth waiting for. */
const TIMEOUT_MS = 3000

export async function shortenUrl(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    })
    if (!res.ok) return url
    const data = (await res.json()) as { shortUrl?: unknown }
    return typeof data?.shortUrl === 'string' && data.shortUrl ? data.shortUrl : url
  } catch {
    return url
  } finally {
    clearTimeout(timer)
  }
}
