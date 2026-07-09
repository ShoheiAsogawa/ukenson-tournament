import { createClient } from '@supabase/supabase-js'
import { createInitialState, normalizeState } from './tournamentEngine'

const STORAGE_KEY = 'ukenson-tournament-state-v2'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID || 'ukenson-2026-renseihai'
const DIRECT_WRITE_ENABLED = import.meta.env.VITE_SUPABASE_DIRECT_WRITE === 'true'
const LOCAL_ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN

export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
export const usesServerAdminAuth = hasSupabaseConfig && !LOCAL_ADMIN_PIN

export const supabase = hasSupabaseConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

const liveChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ukenson-tournament-live') : null
let lastSavedJson = null
let lastKnownJson = null
let lastKnownUpdatedAt = null

function stateJson(payload) {
  return JSON.stringify(normalizeState(payload))
}

function rememberPayload(payload, updatedAt = payload?.updatedAt || null) {
  const normalized = normalizeState(payload)
  lastKnownJson = stateJson(normalized)
  lastKnownUpdatedAt = updatedAt || normalized.updatedAt || null
  return normalized
}

function isServerSessionToken(token) {
  return String(token || '').startsWith('v1.')
}

function buildSaveAuthBody(sessionToken) {
  if (isServerSessionToken(sessionToken)) return { sessionToken }
  return { pin: sessionToken }
}

export async function loadTournamentState() {
  if (!supabase) {
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY)
      const payload = cached ? normalizeState(JSON.parse(cached)) : createInitialState()
      return rememberPayload(payload)
    } catch {
      return rememberPayload(createInitialState())
    }
  }

  const { data, error } = await supabase
    .from('tournament_states')
    .select('payload, updated_at')
    .eq('id', TOURNAMENT_ID)
    .maybeSingle()

  if (error) throw error
  return rememberPayload(normalizeState(data?.payload), data?.updated_at || data?.payload?.updatedAt || null)
}

export async function verifyAdminPin(pin) {
  const normalizedPin = String(pin || '')

  if (!supabase) {
    if (!LOCAL_ADMIN_PIN) return { ok: true, sessionToken: '', error: null }
    return {
      ok: normalizedPin === LOCAL_ADMIN_PIN,
      sessionToken: normalizedPin === LOCAL_ADMIN_PIN ? normalizedPin : '',
      error: normalizedPin === LOCAL_ADMIN_PIN ? null : 'invalid_pin',
    }
  }

  if (LOCAL_ADMIN_PIN) {
    return {
      ok: normalizedPin === LOCAL_ADMIN_PIN,
      sessionToken: normalizedPin === LOCAL_ADMIN_PIN ? normalizedPin : '',
      error: normalizedPin === LOCAL_ADMIN_PIN ? null : 'invalid_pin',
    }
  }

  const { data, error } = await supabase.functions.invoke('verify-admin-pin', {
    body: { pin: normalizedPin },
  })

  if (data?.error === 'rate_limited') {
    return { ok: false, sessionToken: '', error: 'rate_limited' }
  }
  if (data?.error === 'server_not_configured') {
    return { ok: false, sessionToken: '', error: 'server_not_configured' }
  }
  if (data?.ok === false) {
    return { ok: false, sessionToken: '', error: data?.error || 'invalid_pin' }
  }
  if (error && !data?.ok) {
    return { ok: false, sessionToken: '', error: 'auth_unavailable' }
  }

  if (!data?.ok) return { ok: false, sessionToken: '', error: 'invalid_pin' }

  // Legacy Edge Function may return ok without sessionToken until redeployed.
  const sessionToken = String(data.sessionToken || normalizedPin || '')
  return { ok: true, sessionToken, error: null }
}

export async function saveTournamentState(state, { sessionToken } = {}) {
  const payload = normalizeState(state)
  const json = stateJson(payload)
  if (json === lastSavedJson || json === lastKnownJson) return payload

  if (!supabase) {
    lastSavedJson = json
    rememberPayload(payload)
    window.localStorage.setItem(STORAGE_KEY, json)
    liveChannel?.postMessage(payload)
    return payload
  }

  if (sessionToken) {
    const { data, error } = await supabase.functions.invoke('save-tournament-state', {
      body: {
        id: TOURNAMENT_ID,
        payload,
        ...buildSaveAuthBody(sessionToken),
        expectedUpdatedAt: lastKnownUpdatedAt,
      },
    })

    if (data?.error === 'conflict') throw new Error('conflict')
    if (data && data.ok === false) throw new Error(data.error || 'save_failed')
    if (error) throw error

    lastSavedJson = json
    rememberPayload(payload, data?.updatedAt || payload.updatedAt)
    return payload
  }

  if (!DIRECT_WRITE_ENABLED) {
    throw new Error('Admin write token is required for Supabase saves.')
  }

  const { error } = await supabase.from('tournament_states').upsert({
    id: TOURNAMENT_ID,
    payload,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
  lastSavedJson = json
  rememberPayload(payload)
  return payload
}

export async function recordTableResult({ tableNumber, matchId, winnerId, scoreA, scoreB, memo = '' }) {
  if (!supabase) {
    throw new Error('Supabase is required for table staff saves.')
  }

  const { data, error } = await supabase.functions.invoke('record-table-result', {
    body: {
      id: TOURNAMENT_ID,
      tableNumber,
      matchId,
      winnerId,
      scoreA,
      scoreB,
      memo,
    },
  })

  if (data?.error === 'conflict' || data?.error === 'match_not_on_table') throw new Error('conflict')
  if (data && data.ok === false) throw new Error(data.error || 'save_failed')
  if (error) throw error

  const payload = rememberPayload(normalizeState(data?.payload), data?.updatedAt || data?.payload?.updatedAt || null)
  lastSavedJson = stateJson(payload)
  return payload
}

export function subscribeTournamentState(onPayload) {
  if (!supabase) {
    const handleMessage = (event) => {
      onPayload(rememberPayload(normalizeState(event.data)))
    }
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          onPayload(rememberPayload(normalizeState(JSON.parse(event.newValue))))
        } catch {
          // ignore corrupt local cache
        }
      }
    }
    liveChannel?.addEventListener('message', handleMessage)
    window.addEventListener('storage', handleStorage)
    return () => {
      liveChannel?.removeEventListener('message', handleMessage)
      window.removeEventListener('storage', handleStorage)
    }
  }

  const channel = supabase
    .channel(`tournament-state-${TOURNAMENT_ID}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'tournament_states',
        filter: `id=eq.${TOURNAMENT_ID}`,
      },
      (payload) => {
        const next = rememberPayload(
          normalizeState(payload.new?.payload),
          payload.new?.updated_at || payload.new?.payload?.updatedAt || null,
        )
        onPayload(next)
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
