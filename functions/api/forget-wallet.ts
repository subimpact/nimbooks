// POST /api/forget-wallet — removes a wallet's connection record when its owner
// taps "Don't count me" in the app.
//
// The record (hash, masked address, wallet app, device, first/last seen, visit
// count) is deleted and the wallet count is recounted from what remains. Visit
// totals stay: they are plain numbers with no address attached.
//
// Anyone who knows an address could call this for it. The worst outcome is one
// wallet missing from a public count, so no proof of ownership is asked for.

import {
  type KVNamespace,
  SUMMARY_KEY,
  countWalletRecords,
  isNimiqAddress,
  parseStats,
  walletKey,
} from '../_lib/connectStats'

interface Ctx {
  request: Request
  env: { EXPORT_KV?: KVNamespace }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  })
}

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  try {
    const body = (await request.json().catch(() => ({}))) as { address?: string }
    const cleanAddr = String(body.address || '').replace(/\s+/g, '')
    if (!isNimiqAddress(cleanAddr)) return json({ error: 'invalid address' }, 400)
    if (!env.EXPORT_KV) return json({ ok: true, removed: false })

    const kv = env.EXPORT_KV
    const key = await walletKey(cleanAddr)
    const existed = (await kv.get(key)) !== null
    if (existed) {
      await kv.delete(key)
      const stats = parseStats(await kv.get(SUMMARY_KEY))
      stats.uniqueWallets = await countWalletRecords(kv)
      stats.updatedAt = Date.now()
      await kv.put(SUMMARY_KEY, JSON.stringify(stats))
    }
    return json({ ok: true, removed: existed })
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}
