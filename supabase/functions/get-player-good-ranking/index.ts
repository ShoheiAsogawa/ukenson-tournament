import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeAdmin, clientKey, rateLimit } from '../_shared/auth.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const adminPin = Deno.env.get('ADMIN_PIN')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!adminPin || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)
  }

  if (!rateLimit(`player-good-ranking:${clientKey(request)}`, 30, 60_000)) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
  }

  try {
    const { id, pin, sessionToken } = await request.json()
    const authorized = await authorizeAdmin(adminPin, { pin, sessionToken })
    if (!authorized) return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    if (!id || typeof id !== 'string' || id.length > 128) {
      return jsonResponse({ ok: false, error: 'bad_tournament_id' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const [tournamentResult, goodsResult] = await Promise.all([
      supabase.from('tournament_states').select('payload').eq('id', id).maybeSingle(),
      supabase.from('player_goods').select('player_id, good_count').eq('tournament_id', id),
    ])

    if (tournamentResult.error) return jsonResponse({ ok: false, error: tournamentResult.error.message }, 500)
    if (goodsResult.error) return jsonResponse({ ok: false, error: goodsResult.error.message }, 500)

    const players = Array.isArray(tournamentResult.data?.payload?.players)
      ? tournamentResult.data.payload.players
      : []
    const activePlayerIds = new Set(
      players
        .filter((player: Record<string, unknown>) => player?.active !== false && Boolean(player?.name))
        .map((player: Record<string, unknown>) => String(player.id || '')),
    )
    const ranking = (goodsResult.data || [])
      .filter((row) => activePlayerIds.has(String(row.player_id)) && Number(row.good_count) > 0)
      .map((row) => ({ playerId: String(row.player_id), count: Number(row.good_count) || 0 }))
      .sort((left, right) => right.count - left.count || left.playerId.localeCompare(right.playerId))

    return jsonResponse({ ok: true, ranking })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
