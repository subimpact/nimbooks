// POST /api/pdf-probe — stores one run of the throwaway /pdf-test/ diagnostic
// page (which PDF hand-off methods work inside the Nimiq Pay WebView).
//
// Holds a user agent, the tester's verdicts and an event log, nothing about any
// wallet. Kept 14 days, then KV deletes it. Remove this route together with
// public/pdf-test/ once the question is answered.

import { isFromApp } from '../_lib/fromApp'

interface KVNamespace {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface Ctx {
  request: Request
  env: { EXPORT_KV?: KVNamespace }
}

const MAX_BODY = 32_000
const TTL_SECONDS = 14 * 24 * 3600

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  if (!isFromApp(request)) return json(403, { error: 'forbidden' })
  if (!env.EXPORT_KV) return json(503, { error: 'storage unavailable' })
  const text = await request.text()
  if (text.length > MAX_BODY) return json(413, { error: 'too large' })
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return json(400, { error: 'bad json' })
  }
  if (!parsed || typeof parsed !== 'object') return json(400, { error: 'bad body' })
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const record = {
    ...(parsed as Record<string, unknown>),
    receivedAt: new Date().toISOString(),
    country: request.headers.get('CF-IPCountry'),
  }
  await env.EXPORT_KV.put(`pdfprobe:${id}`, JSON.stringify(record), { expirationTtl: TTL_SECONDS })
  return json(200, { ok: true, id })
}
