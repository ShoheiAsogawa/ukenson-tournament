import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clientKey, rateLimit } from '../_shared/auth.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const requestClientKey = clientKey(request)
  if (!rateLimit(`player-good-venue:${requestClientKey}`, 6000, 60_000)) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)
  }

  try {
    const body = await request.json()
    const id = String(body?.id || '')
    const playerId = String(body?.playerId || '')
    const amount = Number(body?.amount)
    const goodsClientId = String(body?.clientId || '')

    if (
      !id ||
      id.length > 128 ||
      !playerId ||
      playerId.length > 128 ||
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 25 ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(goodsClientId)
    ) {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }
    if (!rateLimit(`player-good-device:${requestClientKey}:${goodsClientId}`, 300, 60_000)) {
      return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: tournament, error: tournamentError } = await supabase
      .from('tournament_states')
      .select('payload')
      .eq('id', id)
      .maybeSingle()

    if (tournamentError) return jsonResponse({ ok: false, error: tournamentError.message }, 500)
    const players = Array.isArray(tournament?.payload?.players) ? tournament.payload.players : []
    const playerExists = players.some((player: Record<string, unknown>) => (
      String(player?.id || '') === playerId && player?.active !== false && Boolean(player?.name)
    ))
    if (!playerExists) return jsonResponse({ ok: false, error: 'player_not_found' }, 404)

    const { data: count, error } = await supabase.rpc('increment_player_good', {
      p_tournament_id: id,
      p_player_id: playerId,
      p_amount: amount,
    })

    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    return jsonResponse({ ok: true, playerId, count: Number(count) || 0 })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
