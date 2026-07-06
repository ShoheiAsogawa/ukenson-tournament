import { createClient } from '@supabase/supabase-js'
import { createInitialState, normalizeState } from './tournamentEngine'

const STORAGE_KEY = 'ukenson-tournament-state-v2'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID || 'ukenson-2026-renseihai'

export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = hasSupabaseConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

const liveChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ukenson-tournament-live') : null
let lastSavedJson = null

export async function loadTournamentState() {
  if (!supabase) {
    const cached = window.localStorage.getItem(STORAGE_KEY)
    return cached ? normalizeState(JSON.parse(cached)) : createInitialState()
  }

  const { data, error } = await supabase
    .from('tournament_states')
    .select('payload')
    .eq('id', TOURNAMENT_ID)
    .maybeSingle()

  if (error) throw error
  return normalizeState(data?.payload)
}

export async function saveTournamentState(state) {
  const payload = normalizeState(state)

  if (!supabase) {
    const json = JSON.stringify(payload)
    if (json === lastSavedJson) return payload
    lastSavedJson = json
    window.localStorage.setItem(STORAGE_KEY, json)
    liveChannel?.postMessage(payload)
    return payload
  }

  const { error } = await supabase
    .from('tournament_states')
    .upsert({ id: TOURNAMENT_ID, payload, updated_at: new Date().toISOString() })

  if (error) throw error
  return payload
}

export function subscribeTournamentState(onPayload) {
  if (!supabase) {
    const handleMessage = (event) => onPayload(normalizeState(event.data))
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        onPayload(normalizeState(JSON.parse(event.newValue)))
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
      (payload) => onPayload(normalizeState(payload.new?.payload)),
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
