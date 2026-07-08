import { createClient } from '@supabase/supabase-js'
import { createInitialState, normalizeState } from './tournamentEngine'

const STORAGE_KEY = 'ukenson-tournament-state-v2'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID || 'ukenson-2026-renseihai'
const DIRECT_WRITE_ENABLED = import.meta.env.VITE_SUPABASE_DIRECT_WRITE === 'true'

export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = hasSupabaseConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

const liveChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ukenson-tournament-live') : null
let lastSavedJson = null
let lastKnownJson = null

function stateJson(payload) {
  return JSON.stringify(normalizeState(payload))
}

export async function loadTournamentState() {
  if (!supabase) {
    const cached = window.localStorage.getItem(STORAGE_KEY)
    const payload = cached ? normalizeState(JSON.parse(cached)) : createInitialState()
    lastKnownJson = stateJson(payload)
    return payload
  }

  const { data, error } = await supabase
    .from('tournament_states')
    .select('payload')
    .eq('id', TOURNAMENT_ID)
    .maybeSingle()

  if (error) throw error
  const payload = normalizeState(data?.payload)
  lastKnownJson = stateJson(payload)
  return payload
}

export async function verifyAdminPin(pin) {
  if (!supabase) return true

  const { data, error } = await supabase.functions.invoke('verify-admin-pin', {
    body: { pin: String(pin || '') },
  })

  if (error) throw error
  return Boolean(data?.ok)
}

export async function saveTournamentState(state, { operatorPin } = {}) {
  const payload = normalizeState(state)
  const json = stateJson(payload)
  if (json === lastSavedJson || json === lastKnownJson) return payload

  if (!supabase) {
    lastSavedJson = json
    lastKnownJson = json
    window.localStorage.setItem(STORAGE_KEY, json)
    liveChannel?.postMessage(payload)
    return payload
  }

  if (operatorPin) {
    const { error } = await supabase.functions.invoke('save-tournament-state', {
      body: { id: TOURNAMENT_ID, payload, pin: operatorPin },
    })

    if (error) throw error
    lastSavedJson = json
    lastKnownJson = json
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
  lastKnownJson = json
  return payload
}

export function subscribeTournamentState(onPayload) {
  if (!supabase) {
    const handleMessage = (event) => {
      const payload = normalizeState(event.data)
      lastKnownJson = stateJson(payload)
      onPayload(payload)
    }
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        const payload = normalizeState(JSON.parse(event.newValue))
        lastKnownJson = stateJson(payload)
        onPayload(payload)
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
        const next = normalizeState(payload.new?.payload)
        lastKnownJson = stateJson(next)
        onPayload(next)
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
