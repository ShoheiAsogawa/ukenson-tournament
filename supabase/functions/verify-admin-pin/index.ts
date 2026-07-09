import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  authorizeAdmin,
  clientKey,
  createSessionToken,
  rateLimit,
} from '../_shared/auth.ts'

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)

  if (!rateLimit(`verify:${clientKey(request)}`, 20, 60_000)) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
  }

  try {
    const { pin } = await request.json()
    const authorized = await authorizeAdmin(adminPin, { pin })
    if (!authorized) return jsonResponse({ ok: false, error: 'unauthorized' }, 401)

    const sessionToken = await createSessionToken(adminPin)
    return jsonResponse({ ok: true, sessionToken })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
