// POST /api/track-connect — records wallet sign-ins and alerts Matrix.
//
// The app calls this only after the user has seen the counting notice and not
// opted out (src/lib/connectCount.ts). What is kept, per wallet: a SHA-256 of
// the address as the key, a masked form (first and last four characters), the
// wallet app, the device type, first/last seen and a visit count.

import {
  type KVNamespace,
  SUMMARY_KEY,
  VISIT_WINDOW_MS,
  countWalletRecords,
  isNimiqAddress,
  needsRecount,
  parseStats,
  walletKey,
} from '../_lib/connectStats'

interface Ctx {
  request: Request
  env: {
    EXPORT_KV?: KVNamespace
    MATRIX_ACCESS_TOKEN?: string
    MATRIX_ROOM_ID?: string
    MATRIX_HOMESERVER?: string
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  })
}

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      address?: string
      provider?: string
      platform?: string
    }

    const rawAddress = String(body.address || '').trim()
    const provider = String(body.provider || 'pay').toLowerCase()
    const platform = String(body.platform || 'web').toLowerCase()

    if (!rawAddress) return json({ error: 'missing address' }, 400)

    const isDemo = rawAddress.toLowerCase() === 'demo' || provider === 'demo'
    const cleanAddr = rawAddress.replace(/\s+/g, '')
    // Random strings never reach the count: only a checksum-valid Nimiq address
    // (or the sample wallet) is recorded.
    if (!isDemo && !isNimiqAddress(cleanAddr)) return json({ error: 'invalid address' }, 400)

    const maskedAddr = isDemo ? 'Demo Sample Wallet' : `${cleanAddr.slice(0, 4)}…${cleanAddr.slice(-4)}`

    let isNew = false
    let countedVisit = false
    let stats = parseStats(null)

    if (env.EXPORT_KV) {
      const kv = env.EXPORT_KV
      const rawSummary = await kv.get(SUMMARY_KEY)
      stats = parseStats(rawSummary)
      const now = Date.now()

      const key = await walletKey(cleanAddr)
      const existing = await kv.get(key)

      if (!existing) {
        isNew = true
        countedVisit = true
        await kv.put(key, JSON.stringify({ firstSeen: now, lastSeen: now, count: 1, provider, platform, masked: maskedAddr }))
      } else {
        let w: { lastSeen?: number; firstSeen?: number; count?: number } = {}
        try {
          w = JSON.parse(existing)
        } catch {
          /* unreadable record — rewrite it below */
        }
        // A reload or a reconnect inside the window is the same visit.
        countedVisit = now - (w.lastSeen || w.firstSeen || 0) > VISIT_WINDOW_MS
        await kv.put(
          key,
          JSON.stringify({ ...w, lastSeen: now, count: (w.count || 1) + (countedVisit ? 1 : 0), provider, platform })
        )
      }

      // Recount from the records whenever the wallet set changed, or the
      // summary is still v1 (seeded) — the records are the source of truth.
      if ((isNew && !isDemo) || needsRecount(rawSummary)) {
        stats.uniqueWallets = await countWalletRecords(kv)
      }

      if (countedVisit) {
        if (provider === 'pay') stats.pay += 1
        else if (provider === 'hub') stats.hub += 1
        else if (provider === 'demo') stats.demo += 1
      }
      stats.totalConnections = stats.pay + stats.hub
      stats.updatedAt = now

      await kv.put(SUMMARY_KEY, JSON.stringify(stats))
    }

    // Matrix alert for real wallet sign-ins (demo pings only the first time).
    // Goes to the owner's own homeserver; carries the masked address only.
    if (env.MATRIX_ACCESS_TOKEN && env.MATRIX_ROOM_ID && countedVisit && (!isDemo || isNew)) {
      const server = (env.MATRIX_HOMESERVER || 'https://matrix.subimpact.net').replace(/\/+$/, '')
      const roomId = encodeURIComponent(env.MATRIX_ROOM_ID)
      const txnId = `connect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const url = `${server}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`

      const icon = isNew ? '🎉 New Sign-in' : '⚡ Wallet Active'
      const providerLabel = provider === 'pay' ? 'Nimiq Pay' : provider === 'hub' ? 'Nimiq Hub' : 'Demo'
      const plainText = `${icon} | ${maskedAddr} via ${providerLabel} (${platform}) • Unique wallets: ${stats.uniqueWallets} (visits: ${stats.totalConnections})`
      const htmlText = `${isNew ? '🎉' : '⚡'} <b>${isNew ? 'New Sign-in' : 'Wallet Active'}</b> | <code>${maskedAddr}</code> via <b>${providerLabel}</b> (${platform})<br>Unique wallets: <b>${stats.uniqueWallets}</b> • Visits: <b>${stats.totalConnections}</b>`

      // Await fetch to Matrix so the edge worker does not terminate before delivery
      try {
        await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
          body: JSON.stringify({ msgtype: 'm.text', body: plainText, format: 'org.matrix.custom.html', formatted_body: htmlText }),
        })
      } catch (e) {
        console.error('Matrix ping error:', e)
      }
    }

    return json({
      ok: true,
      isNew,
      stats: { uniqueWallets: stats.uniqueWallets, totalConnections: stats.totalConnections, since: stats.since },
    })
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}
