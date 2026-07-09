import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { clientKey, isPlainObject, rateLimit } from '../_shared/auth.ts'

const MAX_PLAYERS = 128
const MIN_BRACKET_SIZE = 2
const DEFAULT_TABLE_COUNT = 8
const MIN_TABLE_COUNT = 1
const MAX_TABLE_COUNT = 32

function clampTableCount(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_TABLE_COUNT
  return Math.max(MIN_TABLE_COUNT, Math.min(MAX_TABLE_COUNT, Math.round(numeric)))
}

function normalizeTableAssignments(assignments: unknown, tableCount: number) {
  if (!assignments || typeof assignments !== 'object') return {} as Record<string, number>
  return Object.entries(assignments as Record<string, unknown>).reduce((next, [matchId, tableNumber]) => {
    const numeric = Number(tableNumber)
    if (matchId && Number.isInteger(numeric) && numeric >= 1 && numeric <= tableCount) {
      next[matchId] = numeric
    }
    return next
  }, {} as Record<string, number>)
}

function createInitialState() {
  return {
    players: [] as Array<Record<string, unknown>>,
    results: {} as Record<string, unknown>,
    entriesMeta: {
      importedCount: 0,
      waitlistCount: 0,
      source: 'empty',
      importedAt: null as string | null,
    },
    tableCount: DEFAULT_TABLE_COUNT,
    tableAssignments: {} as Record<string, number>,
    selectedMatchId: null as string | null,
    mode: 'operator',
    timer: null as Record<string, unknown> | null,
    lastFxEvent: null as Record<string, unknown> | null,
    updatedAt: new Date().toISOString(),
  }
}

function normalizeState(value: unknown) {
  const fallback = createInitialState()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  const tableCount = clampTableCount(raw.tableCount ?? fallback.tableCount)

  return {
    players: Array.isArray(raw.players) ? raw.players : fallback.players,
    results: raw.results && typeof raw.results === 'object' ? (raw.results as Record<string, unknown>) : {},
    entriesMeta:
      raw.entriesMeta && typeof raw.entriesMeta === 'object'
        ? { ...fallback.entriesMeta, ...(raw.entriesMeta as Record<string, unknown>) }
        : fallback.entriesMeta,
    tableCount,
    tableAssignments: normalizeTableAssignments(raw.tableAssignments, tableCount),
    selectedMatchId: (raw.selectedMatchId as string) || fallback.selectedMatchId,
    mode: raw.mode === 'spectator' ? 'spectator' : 'operator',
    timer: raw.timer && typeof raw.timer === 'object' ? (raw.timer as Record<string, unknown>) : null,
    lastFxEvent:
      raw.lastFxEvent && typeof raw.lastFxEvent === 'object'
        ? (raw.lastFxEvent as Record<string, unknown>)
        : null,
    updatedAt: (raw.updatedAt as string) || fallback.updatedAt,
  }
}

function nextPowerOfTwo(value: number) {
  if (value <= MIN_BRACKET_SIZE) return MIN_BRACKET_SIZE
  return 2 ** Math.ceil(Math.log2(Math.min(value, MAX_PLAYERS)))
}

function getBracketSize(players: Array<Record<string, unknown>>) {
  const activeCount = players.filter((player) => player.active !== false && player.name).length
  return nextPowerOfTwo(activeCount)
}

function padSlots(players: Array<Record<string, unknown>>, bracketSize: number) {
  const activePlayers = players
    .filter((player) => player.active !== false && player.name)
    .slice(0, MAX_PLAYERS)
  const slots = activePlayers.map((player, index) => ({
    ...player,
    id: player.id || `p${index + 1}`,
    seed: index + 1,
    active: true,
  }))

  while (slots.length < bracketSize) {
    slots.push({
      id: `bye-${slots.length + 1}`,
      seed: slots.length + 1,
      name: 'BYE',
      active: false,
      bye: true,
    })
  }

  return slots
}

function matchId(prefix: string, round: number, index: number) {
  return `${prefix}${round}-${index + 1}`
}

function generateMatchPlan(bracketSize: number) {
  const rounds = Math.log2(bracketSize)
  const plan: Array<Record<string, unknown>> = []

  for (let round = 1; round <= rounds; round += 1) {
    const count = bracketSize / 2 ** round
    for (let index = 0; index < count; index += 1) {
      plan.push({
        id: matchId('w', round, index),
        side: 'winners',
        round,
        index,
        a: round === 1 ? { seed: index * 2 } : { winner: matchId('w', round - 1, index * 2) },
        b: round === 1 ? { seed: index * 2 + 1 } : { winner: matchId('w', round - 1, index * 2 + 1) },
      })
    }
  }

  if (bracketSize > 2) {
    for (let loserRound = 1; loserRound <= rounds * 2 - 2; loserRound += 1) {
      const isEvenRound = loserRound % 2 === 0
      const pairRound = Math.ceil(loserRound / 2)
      const count = bracketSize / 2 ** (pairRound + 1)

      for (let index = 0; index < count; index += 1) {
        const previousRound = loserRound - 1
        const previousMatch = (previousIndex: number) => matchId('l', previousRound, previousIndex)
        const currentId = matchId('l', loserRound, index)

        let a
        let b
        if (loserRound === 1) {
          a = { loser: matchId('w', 1, index * 2) }
          b = { loser: matchId('w', 1, index * 2 + 1) }
        } else if (isEvenRound) {
          a = { winner: previousMatch(index) }
          b = { loser: matchId('w', pairRound + 1, index) }
        } else {
          a = { winner: previousMatch(index * 2) }
          b = { winner: previousMatch(index * 2 + 1) }
        }

        plan.push({
          id: currentId,
          side: 'losers',
          round: loserRound,
          index,
          a,
          b,
        })
      }
    }
  }

  const winnersFinalId = matchId('w', rounds, 0)
  const losersFinalId = bracketSize === 2 ? winnersFinalId : matchId('l', rounds * 2 - 2, 0)

  plan.push({
    id: 'gf',
    side: 'finals',
    round: 1,
    index: 0,
    a: { winner: winnersFinalId },
    b: bracketSize === 2 ? { loser: winnersFinalId } : { winner: losersFinalId },
  })
  plan.push({
    id: 'gfr',
    side: 'finals',
    round: 2,
    index: 0,
    a: { winner: 'gf' },
    b: { loser: 'gf' },
    resetOnly: true,
  })

  return plan
}

function resolveSlot(
  slot: Record<string, unknown>,
  players: Array<Record<string, unknown>>,
  resultMap: Record<string, Record<string, unknown>>,
) {
  if ('seed' in slot) return players[slot.seed as number] || null

  const source = resultMap[(slot.winner as string) || (slot.loser as string)]
  if (!source?.winnerId) return null

  if ('winner' in slot) return players.find((player) => player.id === source.winnerId) || null
  const loserId = (source.playerIds as string[] | undefined)?.find((id) => id !== source.winnerId)
  return players.find((player) => player.id === loserId) || null
}

function getAutoWinner(playerA: Record<string, unknown> | null, playerB: Record<string, unknown> | null) {
  if (playerA?.active !== false && playerB?.bye) return playerA
  if (playerB?.active !== false && playerA?.bye) return playerB
  return null
}

function isResetNeeded(resultMap: Record<string, Record<string, unknown>>) {
  const grandFinal = resultMap.gf
  const grandFinalPlayers = (grandFinal?.playerIds as string[]) || []
  return Boolean(
    grandFinal?.winnerId && grandFinalPlayers.length === 2 && grandFinal.winnerId !== grandFinalPlayers[0],
  )
}

function buildBracket(state: ReturnType<typeof normalizeState>) {
  const cleanState = normalizeState(state)
  const bracketSize = getBracketSize(cleanState.players)
  const players = padSlots(cleanState.players, bracketSize)
  const plan = generateMatchPlan(bracketSize)
  const resultMap: Record<string, Record<string, unknown>> = {}
  const matches: Array<Record<string, unknown>> = []

  for (const item of plan) {
    if (item.resetOnly && !isResetNeeded(resultMap)) continue

    const playerA = resolveSlot(item.a as Record<string, unknown>, players, resultMap)
    const playerB = resolveSlot(item.b as Record<string, unknown>, players, resultMap)
    const autoWinner = getAutoWinner(playerA, playerB)
    const saved = cleanState.results[item.id as string] as Record<string, unknown> | undefined
    const ready = Boolean(playerA && playerB && !playerA.bye && !playerB.bye)
    const completed = Boolean(saved?.winnerId || autoWinner)
    const winnerId = (saved?.winnerId as string) || (autoWinner?.id as string) || null
    const playerIds = [playerA?.id, playerB?.id].filter(
      (id) => id && !String(id).startsWith('bye-'),
    ) as string[]

    const match = {
      ...item,
      playerA,
      playerB,
      ready,
      completed,
      bye: Boolean(autoWinner && !saved?.winnerId),
      autoAdvanced: Boolean(autoWinner && !saved?.winnerId),
      winnerId,
      playerIds,
      tableNumber: Number(cleanState.tableAssignments[item.id as string]) || null,
    }

    if (completed) {
      resultMap[item.id as string] = {
        ...saved,
        winnerId,
        playerIds,
      }
    }

    matches.push(match)
  }

  return { matches, playOrder: matches.filter((match) => !match.bye) }
}

function isActiveTableMatch(match: Record<string, unknown> | undefined) {
  return Boolean(match?.ready && !match.completed && !match.bye)
}

function recordResult(
  state: ReturnType<typeof normalizeState>,
  targetMatchId: string,
  winnerId: string,
  scoreA: number,
  scoreB: number,
  memo = '',
) {
  const bracket = buildBracket(state)
  const match = bracket.matches.find((item) => item.id === targetMatchId)
  if (!match?.ready || !winnerId) return null
  if (!(match.playerIds as string[])?.includes(winnerId)) return null
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA < 0 || scoreB < 0) return null

  const nextResults = { ...state.results }
  const nextTableAssignments = { ...state.tableAssignments }
  const changedIndex = bracket.matches.findIndex((item) => item.id === targetMatchId)
  for (const item of bracket.matches.slice(changedIndex)) {
    delete nextResults[item.id as string]
  }
  for (const item of bracket.matches.slice(changedIndex + 1)) {
    delete nextTableAssignments[item.id as string]
  }

  nextResults[targetMatchId] = {
    winnerId,
    scoreA,
    scoreB,
    playerIds: match.playerIds,
    memo: String(memo || '').slice(0, 500),
    recordedAt: new Date().toISOString(),
  }

  const winner =
    (match.playerA as Record<string, unknown> | null)?.id === winnerId
      ? (match.playerA as Record<string, unknown>)
      : (match.playerB as Record<string, unknown> | null)
  const fxVariant = match.id === 'gfr' ? 'reset' : match.side === 'finals' ? 'gf' : 'normal'

  const nextState = {
    ...state,
    results: nextResults,
    tableAssignments: nextTableAssignments,
    updatedAt: new Date().toISOString(),
    lastFxEvent: winner
      ? {
          matchId: targetMatchId,
          name: winner.name,
          side: match.side,
          variant: fxVariant,
          at: Date.now(),
        }
      : state.lastFxEvent,
  }
  const nextBracket = buildBracket(nextState)
  const nextMatch = nextBracket.playOrder.find((item) => !item.completed) || null
  return {
    ...nextState,
    selectedMatchId: (nextMatch?.id as string) || targetMatchId,
  }
}

function autoAssignReadyTables(
  state: ReturnType<typeof normalizeState>,
  { preferTableNumber = null }: { preferTableNumber?: number | null } = {},
) {
  const tableCount = clampTableCount(state.tableCount)
  const preferred =
    Number.isInteger(Number(preferTableNumber)) &&
    Number(preferTableNumber) >= 1 &&
    Number(preferTableNumber) <= tableCount
      ? Number(preferTableNumber)
      : null
  const normalized = {
    ...state,
    tableCount,
    tableAssignments: state.tableAssignments || {},
  }
  const bracket = buildBracket(normalized)
  const nextAssignments = { ...normalized.tableAssignments }
  const reservedTables = new Set<number>()
  let changed = normalized.tableCount !== state.tableCount

  for (const match of bracket.playOrder) {
    if (!isActiveTableMatch(match)) continue
    const assigned = Number(nextAssignments[match.id as string])
    if (Number.isInteger(assigned) && assigned >= 1 && assigned <= tableCount && !reservedTables.has(assigned)) {
      reservedTables.add(assigned)
      continue
    }
    if (nextAssignments[match.id as string] != null) changed = true
    delete nextAssignments[match.id as string]
  }

  const freeTables = Array.from({ length: tableCount }, (_, index) => index + 1).filter(
    (tableNumber) => !reservedTables.has(tableNumber),
  )
  if (preferred && freeTables.includes(preferred)) {
    freeTables.splice(freeTables.indexOf(preferred), 1)
    freeTables.unshift(preferred)
  }

  for (const match of bracket.playOrder) {
    if (!isActiveTableMatch(match) || nextAssignments[match.id as string]) continue
    const freeTable = freeTables.shift()
    if (!freeTable) break
    nextAssignments[match.id as string] = freeTable
    reservedTables.add(freeTable)
    changed = true
  }

  if (!changed) return state
  return {
    ...state,
    tableCount,
    tableAssignments: nextAssignments,
    updatedAt: new Date().toISOString(),
  }
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)
  }

  if (!rateLimit(`table-result:${clientKey(request)}`, 60, 60_000)) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
  }

  try {
    const body = await request.json()
    const id = body?.id
    const tableNumber = Number(body?.tableNumber)
    const targetMatchId = String(body?.matchId || '')
    const winnerId = String(body?.winnerId || '')
    const scoreA = Number(body?.scoreA)
    const scoreB = Number(body?.scoreB)
    const memo = String(body?.memo || '')
    const expectedUpdatedAt = body?.expectedUpdatedAt ? String(body.expectedUpdatedAt) : null

    if (!id || typeof id !== 'string') return jsonResponse({ ok: false, error: 'bad_tournament_id' }, 400)
    if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > MAX_TABLE_COUNT) {
      return jsonResponse({ ok: false, error: 'bad_table_number' }, 400)
    }
    if (!targetMatchId || !winnerId) return jsonResponse({ ok: false, error: 'bad_match' }, 400)
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA < 0 || scoreB < 0) {
      return jsonResponse({ ok: false, error: 'bad_score' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: current, error: readError } = await supabase
      .from('tournament_states')
      .select('payload, updated_at')
      .eq('id', id)
      .maybeSingle()

    if (readError) return jsonResponse({ ok: false, error: readError.message }, 500)
    if (!current?.payload || !isPlainObject(current.payload)) {
      return jsonResponse({ ok: false, error: 'tournament_not_found' }, 404)
    }

    if (expectedUpdatedAt && current.updated_at && current.updated_at !== expectedUpdatedAt) {
      return jsonResponse(
        {
          ok: false,
          error: 'conflict',
          currentUpdatedAt: current.updated_at,
          payload: current.payload,
        },
        409,
      )
    }

    const state = normalizeState(current.payload)
    const bracket = buildBracket(state)
    const match = bracket.playOrder.find((item) => item.id === targetMatchId)
    if (!isActiveTableMatch(match) || Number(match?.tableNumber) !== tableNumber) {
      return jsonResponse({ ok: false, error: 'match_not_on_table' }, 409)
    }

    const recorded = recordResult(state, targetMatchId, winnerId, scoreA, scoreB, memo)
    if (!recorded) return jsonResponse({ ok: false, error: 'invalid_result' }, 400)
    const nextState = autoAssignReadyTables(recorded, { preferTableNumber: tableNumber })
    const updatedAt = new Date().toISOString()
    const payload = { ...nextState, updatedAt }

    const { error } = await supabase
      .from('tournament_states')
      .upsert({ id, payload, updated_at: updatedAt })

    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    return jsonResponse({ ok: true, payload, updatedAt })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
