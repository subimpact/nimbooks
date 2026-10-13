// GET /api/supporters — the public support summary for the landing page.
//
// Privacy first: supporter addresses exist only on the server, in memory, and
// are keyed by digest for name lookup. What leaves this endpoint is names and
// amounts, never addresses. Nothing that mentions an address is logged.
//
// The chain reader (rpc.nimiqwatch.com) rate-limits bursts, so the summary is
// cached in KV for five minutes. When the reader fails, the freshest cache
// entry is served even if it is older than that; with nothing cached at all
// the endpoint answers 503 and the landing keeps its address card without the
// supporters list.

import {
  DONATION_ADDRESS,
  fetchDonationRows,
  summariseDonations,
  type DonationSummary,
} from '../_lib/supporters'

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface Ctx {
  request: Request
  env: {
    EXPORT_KV?: KVNamespace
  }
}

const KV_KEY = 'supporters:summary'
const FRESH_MS = 5 * 60 * 1000

interface CachedSummary {
  summary: DonationSummary
  fetchedAt: number
}

const json = (body: unknown, status: 200 | 503 = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    },
  })

export const onRequestGet = async ({ env }: Ctx): Promise<Response> => {
  const kv = env.EXPORT_KV
  const readCache = async (): Promise<CachedSummary | null> => {
    if (!kv) return null
    const raw = await kv.get(KV_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as CachedSummary
      return parsed && typeof parsed.fetchedAt === 'number' && parsed.summary ? parsed : null
    } catch {
      return null
    }
  }

  // Fresh-enough cache answers without touching the rate-limited reader.
  const cached = await readCache()
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    return json(serve(cached.summary))
  }

  try {
    const rows = await fetchDonationRows()
    const summary = summariseDonations(rows, DONATION_ADDRESS)
    const entry: CachedSummary = { summary, fetchedAt: Date.now() }
    if (kv) {
      try {
        await kv.put(KV_KEY, JSON.stringify(entry), { expirationTtl: 60 * 60 * 6 })
      } catch {
        /* a full or failing KV must not turn a good read into an error */
      }
    }
    return json(serve(summary))
  } catch {
    // Reader down: serve whatever cache has, however stale.
    const stale = cached ?? (await readCache())
    if (stale) return json(serve(stale.summary))
    return json({ error: 'unavailable' }, 503)
  }
}

/** The public shape: the donation address is public, the names are consented. */
const serve = (summary: DonationSummary) => ({
  address: DONATION_ADDRESS,
  totalNim: summary.totalNim,
  count: summary.count,
  supporters: summary.supporters.map((s) => ({ name: s.name, amountNim: s.amountNim, lastAt: s.lastAt })),
  updatedAt: Date.now(),
})