// GET /api/stats — returns public connection metrics for NimBooks landing page.
//
// Read-only: a v1 (seeded) summary is corrected on the fly by parseStats, and
// the next connect rewrites it as v2 with the wallet count taken from records.

import { type KVNamespace, SUMMARY_KEY, parseStats } from '../_lib/connectStats'

interface Ctx {
  request: Request
  env: {
    EXPORT_KV?: KVNamespace
  }
}

export const onRequestGet = async ({ env }: Ctx): Promise<Response> => {
  try {
    const summary = parseStats(env.EXPORT_KV ? await env.EXPORT_KV.get(SUMMARY_KEY) : null)

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30, stale-while-revalidate=120',
        'access-control-allow-origin': '*',
      },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
}
