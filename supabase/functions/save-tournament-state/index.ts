import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  authorizeAdmin,
  clientKey,
  rateLimit,
  validateTournamentPayload,
  verifySessionToken,
} from '../_shared/auth.ts'
import { writeTournamentStateAtomic } from '../_shared/tournamentState.ts'

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const adminPin = Deno.env.get('ADMIN_PIN')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!adminPin || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)
  }

  if (!rateLimit(`save:${clientKey(request)}`, 120, 60_000)) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
  }

  try {
    const { id, payload, pin, sessionToken, expectedUpdatedAt } = await request.json()

    // Prefer short-lived session tokens. Raw PIN is still accepted only as a
    // one-shot fallback when the client has not yet stored a v1 session.
    const hasValidSession =
      Boolean(sessionToken) && (await verifySessionToken(adminPin, String(sessionToken)))
    const authorized = hasValidSession || (await authorizeAdmin(adminPin, { pin, sessionToken }))
    if (!authorized) return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    if (!id || typeof id !== 'string') return jsonResponse({ ok: false, error: 'bad_tournament_id' }, 400)

    const payloadError = validateTournamentPayload(payload)
    if (payloadError) return jsonResponse({ ok: false, error: payloadError }, 400)

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const result = await writeTournamentStateAtomic(supabase, {
      id,
      payload: payload as Record<string, unknown>,
      expectedUpdatedAt: expectedUpdatedAt || null,
    })

    if (!result.ok) {
      if (result.error === 'conflict') {
        return jsonResponse(
          { ok: false, error: 'conflict', currentUpdatedAt: result.currentUpdatedAt },
          409,
        )
      }
      return jsonResponse({ ok: false, error: result.error }, 500)
    }

    return jsonResponse({ ok: true, updatedAt: result.updatedAt })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
