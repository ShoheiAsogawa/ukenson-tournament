import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clientKey, rateLimit } from '../_shared/auth.ts'
import { maskBlockedWords } from '../_shared/cheerFilter.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const MAX_COMMENT_CODEPOINTS = 30
const RETENTION_MS = 2 * 60 * 60 * 1000

const ZERO_WIDTH_CHARS = new RegExp("[\u200B-\u200D\uFEFF]", "g")
// eslint-disable-next-line no-control-regex -- strip control chars from user input on purpose
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')

function sanitizeBody(value: unknown): string {
  return String(value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const requestClientKey = clientKey(request)
  // The venue usually shares one NAT IP, so the per-IP window stays generous.
  if (!rateLimit(`cheer-venue:${requestClientKey}`, 900, 60_000)) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)
  }

  try {
    const requestBody = await request.json()
    const id = String(requestBody?.id || '')
    const rawBody = requestBody?.body
    // Reject oversized input before running normalization regexes over it.
    if (typeof rawBody !== 'string' || rawBody.length > 400) {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }
    const body = sanitizeBody(rawBody)
    const maskedBody = maskBlockedWords(body)
    const cheerClientId = String(requestBody?.clientId || '')

    if (
      !id ||
      id.length > 128 ||
      !body ||
      [...body].length > MAX_COMMENT_CODEPOINTS ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(cheerClientId)
    ) {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }
    if (!rateLimit(`cheer-device:${requestClientKey}:${cheerClientId}`, 10, 60_000)) {
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
    if (!tournament) return jsonResponse({ ok: false, error: 'tournament_not_found' }, 404)
    if (tournament.payload?.cheerCommentsEnabled === false) {
      return jsonResponse({ ok: false, error: 'comments_disabled' }, 403)
    }

    // Opportunistic retention: old comments only matter live, so prune lazily.
    if (Math.random() < 0.1) {
      await supabase
        .from('cheer_comments')
        .delete()
        .eq('tournament_id', id)
        .lt('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
    }

    const { data: inserted, error } = await supabase
      .from('cheer_comments')
      .insert({ tournament_id: id, body: maskedBody })
      .select('id, body, created_at')
      .single()

    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    return jsonResponse({
      ok: true,
      comment: { id: inserted.id, body: inserted.body, at: inserted.created_at },
    })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
