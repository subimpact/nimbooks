// POST /api/track-connect — records wallet sign-ins and alerts Matrix.

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface Ctx {
  request: Request
  env: {
    EXPORT_KV?: KVNamespace
    MATRIX_ACCESS_TOKEN?: string
    MATRIX_ROOM_ID?: string
    MATRIX_HOMESERVER?: string
  }
}

// SHA-256 for privacy hash of wallet address
async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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

    if (!rawAddress) {
      return new Response(JSON.stringify({ error: 'missing address' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    }

    const isDemo = rawAddress.toLowerCase() === 'demo' || provider === 'demo'
    const cleanAddr = rawAddress.replace(/\s+/g, '')
    const hash = await sha256(cleanAddr.toLowerCase())
    const maskedAddr = isDemo
      ? 'Demo Sample Wallet'
      : cleanAddr.length >= 8
      ? `${cleanAddr.slice(0, 4)}…${cleanAddr.slice(-4)}`
      : cleanAddr

    let isNew = false
    let currentStats = {
      uniqueWallets: 18,
      totalConnections: 45,
      pay: 31,
      hub: 14,
      demo: 0,
      updatedAt: Date.now(),
    }

    if (env.EXPORT_KV) {
      const rawSummary = await env.EXPORT_KV.get('stats:summary')
      if (rawSummary) {
        try {
          currentStats = { ...currentStats, ...JSON.parse(rawSummary) }
        } catch {}
      }

      const walletKey = `wallet:${hash}`
      const existingWallet = await env.EXPORT_KV.get(walletKey)

      if (!existingWallet) {
        isNew = true
        if (!isDemo) {
          currentStats.uniqueWallets += 1
        }
        await env.EXPORT_KV.put(
          walletKey,
          JSON.stringify({
            firstSeen: Date.now(),
            count: 1,
            provider,
            platform,
            masked: maskedAddr,
          })
        )
      } else {
        try {
          const w = JSON.parse(existingWallet)
          await env.EXPORT_KV.put(
            walletKey,
            JSON.stringify({
              ...w,
              lastSeen: Date.now(),
              count: (w.count || 1) + 1,
              provider,
              platform,
            })
          )
        } catch {}
      }

      currentStats.totalConnections += 1
      if (provider === 'pay') currentStats.pay += 1
      else if (provider === 'hub') currentStats.hub += 1
      else if (provider === 'demo') currentStats.demo += 1
      currentStats.updatedAt = Date.now()

      await env.EXPORT_KV.put('stats:summary', JSON.stringify(currentStats))
    }

    // Send Matrix alert for real wallet sign-ins (and rate-limit demo pings)
    if (env.MATRIX_ACCESS_TOKEN && env.MATRIX_ROOM_ID && (!isDemo || isNew)) {
      const server = (env.MATRIX_HOMESERVER || 'https://matrix.subimpact.net').replace(/\/+$/, '')
      const roomId = encodeURIComponent(env.MATRIX_ROOM_ID)
      const txnId = `connect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const url = `${server}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`

      const icon = isNew ? '🎉 New Sign-in' : '⚡ Wallet Active'
      const providerLabel = provider === 'pay' ? 'Nimiq Pay' : provider === 'hub' ? 'Nimiq Hub' : 'Demo'
      const plainText = `${icon} | ${maskedAddr} via ${providerLabel} (${platform}) • Unique wallets: ${currentStats.uniqueWallets} (total visits: ${currentStats.totalConnections})`
      const htmlText = `${isNew ? '🎉' : '⚡'} <b>${isNew ? 'New Sign-in' : 'Wallet Active'}</b> | <code>${maskedAddr}</code> via <b>${providerLabel}</b> (${platform})<br>Unique wallets: <b>${currentStats.uniqueWallets}</b> • Total visits: <b>${currentStats.totalConnections}</b>`

      const payload = {
        msgtype: 'm.text',
        body: plainText,
        format: 'org.matrix.custom.html',
        formatted_body: htmlText,
      }

      // Fire and forget fetch to Matrix
      fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: JSON.stringify(payload),
      }).catch((e) => console.error('Matrix ping error:', e))
    }

    return new Response(
      JSON.stringify({
        ok: true,
        isNew,
        stats: {
          uniqueWallets: currentStats.uniqueWallets,
          totalConnections: currentStats.totalConnections,
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      }
    )
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'internal error' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
}
