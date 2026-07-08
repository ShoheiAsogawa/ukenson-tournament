import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const adminPin = Deno.env.get('ADMIN_PIN')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!adminPin || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)
  }

  try {
    const { id, payload, pin } = await request.json()
    if (String(pin || '') !== adminPin) return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    if (!id || typeof id !== 'string') return jsonResponse({ ok: false, error: 'bad_tournament_id' }, 400)
    if (!payload || typeof payload !== 'object') return jsonResponse({ ok: false, error: 'bad_payload' }, 400)

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { error } = await supabase
      .from('tournament_states')
      .upsert({ id, payload, updated_at: new Date().toISOString() })

    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    return jsonResponse({ ok: true })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
