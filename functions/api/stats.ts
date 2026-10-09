// GET /api/stats — returns public connection metrics for NimBooks landing page.

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

export const onRequestGet = async ({ env }: Ctx): Promise<Response> => {
  try {
    let summary = {
      uniqueWallets: 18,
      totalConnections: 45,
      pay: 31,
      hub: 14,
      demo: 0,
      updatedAt: Date.now(),
    }

    if (env.EXPORT_KV) {
      const raw = await env.EXPORT_KV.get('stats:summary')
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (typeof parsed.uniqueWallets === 'number') {
            summary = { ...summary, ...parsed }
          }
        } catch {
          // fallback to defaults
        }
      }
    }

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
