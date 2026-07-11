import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  authorizeAdmin,
  clientKey,
  rateLimit,
  validateTournamentPayload,
} from '../_shared/auth.ts'

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
    const { id, payload, pin, sessionToken, expectedUpdatedAt, resetGoods = false } = await request.json()
    const authorized = await authorizeAdmin(adminPin, { pin, sessionToken })
    if (!authorized) return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    if (!id || typeof id !== 'string') return jsonResponse({ ok: false, error: 'bad_tournament_id' }, 400)
    if (typeof resetGoods !== 'boolean') return jsonResponse({ ok: false, error: 'bad_reset_goods' }, 400)

    const payloadError = validateTournamentPayload(payload)
    if (payloadError) return jsonResponse({ ok: false, error: payloadError }, 400)

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (expectedUpdatedAt) {
      const { data: current, error: readError } = await supabase
        .from('tournament_states')
        .select('updated_at')
        .eq('id', id)
        .maybeSingle()

      if (readError) return jsonResponse({ ok: false, error: readError.message }, 500)
      if (current?.updated_at && current.updated_at !== expectedUpdatedAt) {
        return jsonResponse(
          { ok: false, error: 'conflict', currentUpdatedAt: current.updated_at },
          409,
        )
      }
    }

    const updatedAt = new Date().toISOString()
    const nextPayload = { ...payload, updatedAt }
    if (resetGoods) {
      const { data, error } = await supabase.rpc('save_tournament_state_and_reset_goods', {
        p_tournament_id: id,
        p_payload: nextPayload,
        p_expected_updated_at: expectedUpdatedAt || null,
      })
      if (error) return jsonResponse({ ok: false, error: error.message }, 500)

      const result = Array.isArray(data) ? data[0] : data
      if (result?.conflict) {
        return jsonResponse(
          { ok: false, error: 'conflict', currentUpdatedAt: result.updated_at || null },
          409,
        )
      }
      return jsonResponse({ ok: true, updatedAt: result?.updated_at || updatedAt })
    }

    const { error } = await supabase
      .from('tournament_states')
      .upsert({ id, payload: nextPayload, updated_at: updatedAt })

    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    return jsonResponse({ ok: true, updatedAt })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
