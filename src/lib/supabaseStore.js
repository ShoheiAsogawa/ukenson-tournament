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
const PLAYER_GOODS_STORAGE_KEY = `ukenson-player-goods-v1-${TOURNAMENT_ID}`
const PLAYER_GOODS_CLIENT_KEY = 'ukenson-player-goods-client-v1'
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

export function getLastKnownUpdatedAt() {
  return lastKnownUpdatedAt
}

export function getLastKnownJson() {
  return lastKnownJson
}

/** Apply a remote payload to the local sync baseline (call only when UI accepts it). */
export function acceptRemoteTournamentState(payload, updatedAt = null) {
  return rememberPayload(payload, updatedAt)
}

export function isAdminSessionValid(sessionToken) {
  if (!usesServerAdminAuth) return Boolean(sessionToken) || !LOCAL_ADMIN_PIN
  const token = String(sessionToken || '')
  if (!token) return false

  // Legacy verify-admin-pin may return only { ok: true }, so the client falls
  // back to storing the raw PIN. Accept that until the Edge Function is redeployed.
  if (!isServerSessionToken(token)) return true

  const parts = token.split('.')
  if (parts.length !== 3) return false
  const exp = Number(parts[1])
  return Number.isFinite(exp) && Date.now() < exp
}

export function isAdminSessionExpired(sessionToken) {
  const token = String(sessionToken || '')
  if (!usesServerAdminAuth || !isServerSessionToken(token)) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const exp = Number(parts[1])
  return Number.isFinite(exp) && Date.now() >= exp
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

export async function saveTournamentState(state, { sessionToken, resetGoods = false } = {}) {
  const payload = normalizeState(state)
  const json = stateJson(payload)
  if (!resetGoods && (json === lastSavedJson || json === lastKnownJson)) return payload

  if (!supabase) {
    if (resetGoods) window.localStorage.removeItem(PLAYER_GOODS_STORAGE_KEY)
    lastSavedJson = json
    rememberPayload(payload)
    window.localStorage.setItem(STORAGE_KEY, json)
    liveChannel?.postMessage(payload)
    return payload
  }

  if (sessionToken) {
    if (usesServerAdminAuth && !isAdminSessionValid(sessionToken)) {
      throw new Error('unauthorized')
    }

    const { data, error } = await supabase.functions.invoke('save-tournament-state', {
      body: {
        id: TOURNAMENT_ID,
        payload,
        ...buildSaveAuthBody(sessionToken),
        expectedUpdatedAt: lastKnownUpdatedAt,
        resetGoods,
      },
    })

    if (data?.error === 'conflict') throw new Error('conflict')
    if (data?.error === 'unauthorized') throw new Error('unauthorized')
    if (data && data.ok === false) throw new Error(data.error || 'save_failed')
    if (error) throw error

    lastSavedJson = json
    rememberPayload(payload, data?.updatedAt || payload.updatedAt)
    return payload
  }

  if (!DIRECT_WRITE_ENABLED) {
    throw new Error('Admin write token is required for Supabase saves.')
  }

  if (resetGoods) {
    throw new Error('Admin write token is required to reset player goods.')
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

export async function persistLocalTournamentState(state) {
  const payload = normalizeState(state)
  const json = stateJson(payload)
  lastSavedJson = json
  rememberPayload(payload)
  window.localStorage.setItem(STORAGE_KEY, json)
  liveChannel?.postMessage(payload)
  return payload
}

export async function resetTournamentResults(state, { sessionToken } = {}) {
  return saveTournamentState(state, { sessionToken, resetGoods: true })
}

function normalizeGoodCounts(value) {
  if (!value || typeof value !== 'object') return {}
  return Object.entries(value).reduce((counts, [playerId, count]) => {
    const numeric = Number(count)
    if (playerId && Number.isFinite(numeric) && numeric >= 0) counts[playerId] = Math.floor(numeric)
    return counts
  }, {})
}

function readLocalGoodCounts() {
  try {
    return normalizeGoodCounts(JSON.parse(window.localStorage.getItem(PLAYER_GOODS_STORAGE_KEY) || '{}'))
  } catch {
    return {}
  }
}

function getPlayerGoodsClientId() {
  try {
    const current = window.localStorage.getItem(PLAYER_GOODS_CLIENT_KEY)
    if (current) return current
    const next = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.localStorage.setItem(PLAYER_GOODS_CLIENT_KEY, next)
    return next
  } catch {
    return 'storage-unavailable'
  }
}

export async function loadPlayerGoodRanking({ sessionToken } = {}) {
  if (!supabase) {
    return Object.entries(readLocalGoodCounts()).map(([playerId, count]) => ({ playerId, count }))
  }

  const { data, error } = await supabase.functions.invoke('get-player-good-ranking', {
    body: {
      id: TOURNAMENT_ID,
      ...buildSaveAuthBody(sessionToken),
    },
  })

  if (data?.error === 'unauthorized') throw new Error('unauthorized')
  if (data && data.ok === false) throw new Error(data.error || 'ranking_failed')
  if (error) throw error
  return Array.isArray(data?.ranking) ? data.ranking : []
}

export async function addPlayerGoods(playerId, amount = 1) {
  const safePlayerId = String(playerId || '')
  const safeAmount = Math.max(1, Math.min(500, Math.floor(Number(amount) || 1)))
  if (!safePlayerId) throw new Error('bad_player_id')

  if (!supabase) {
    const counts = readLocalGoodCounts()
    const count = (counts[safePlayerId] || 0) + safeAmount
    counts[safePlayerId] = count
    window.localStorage.setItem(PLAYER_GOODS_STORAGE_KEY, JSON.stringify(counts))
    return count
  }

  let remaining = safeAmount
  let count = 0
  while (remaining > 0) {
    const batchAmount = Math.min(25, remaining)
    const { data, error } = await supabase.functions.invoke('add-player-good', {
      body: {
        id: TOURNAMENT_ID,
        playerId: safePlayerId,
        amount: batchAmount,
        clientId: getPlayerGoodsClientId(),
      },
    })

    if (data && data.ok === false) throw new Error(data.error || 'good_failed')
    if (error) throw error
    count = Number(data?.count) || count
    remaining -= batchAmount
  }
  return count
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
      expectedUpdatedAt: lastKnownUpdatedAt,
    },
  })

  if (data?.error === 'conflict') {
    if (data?.payload) rememberPayload(normalizeState(data.payload), data.currentUpdatedAt || null)
    throw new Error('conflict')
  }
  if (data?.error === 'match_not_on_table') throw new Error('match_not_on_table')
  if (data && data.ok === false) throw new Error(data.error || 'save_failed')
  if (error) throw error

  const payload = rememberPayload(normalizeState(data?.payload), data?.updatedAt || data?.payload?.updatedAt || null)
  lastSavedJson = stateJson(payload)
  return payload
}

export function subscribeTournamentState(onPayload) {
  // Do NOT update lastKnown* here — callers must acceptRemoteTournamentState only when
  // they apply the remote payload. Otherwise conflict guards can be bypassed.
  if (!supabase) {
    const handleMessage = (event) => {
      const next = normalizeState(event.data)
      onPayload(next, { updatedAt: next.updatedAt || null })
    }
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const next = normalizeState(JSON.parse(event.newValue))
          onPayload(next, { updatedAt: next.updatedAt || null })
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
        const next = normalizeState(payload.new?.payload)
        const updatedAt = payload.new?.updated_at || payload.new?.payload?.updatedAt || null
        onPayload(next, { updatedAt })
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
