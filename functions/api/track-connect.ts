// POST /api/track-connect — records wallet sign-ins and alerts Discord.

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface Ctx {
  request: Request
  env: {
    EXPORT_KV?: KVNamespace
    DISCORD_BOT_TOKEN?: string
    DISCORD_CHANNEL_ID?: string
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

    // Send Discord alert for real wallet sign-ins (and rate-limit demo pings)
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID && (!isDemo || isNew)) {
      const icon = isNew ? '🎉 **New Sign-in**' : '⚡ **Wallet Active**'
      const providerLabel = provider === 'pay' ? 'Nimiq Pay' : provider === 'hub' ? 'Nimiq Hub' : 'Demo'
      const content = `${icon} | \`${maskedAddr}\` via **${providerLabel}** (${platform}) • Unique wallets: **${currentStats.uniqueWallets}** (total visits: ${currentStats.totalConnections})`

      // Fire and forget fetch to Discord
      fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://nimbooks.subimpact.net, 1.0)',
        },
        body: JSON.stringify({ content }),
      }).catch((e) => console.error('Discord ping error:', e))
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
