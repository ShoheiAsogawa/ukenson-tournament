export const MAX_PLAYERS = 128
export const MIN_BRACKET_SIZE = 2
export const DEFAULT_TABLE_COUNT = 8
export const MIN_TABLE_COUNT = 1
export const MAX_TABLE_COUNT = 32

export function clampTableCount(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_TABLE_COUNT
  return Math.max(MIN_TABLE_COUNT, Math.min(MAX_TABLE_COUNT, Math.round(numeric)))
}

function normalizeTableAssignments(assignments, tableCount) {
  if (!assignments || typeof assignments !== 'object') return {}
  return Object.entries(assignments).reduce((next, [matchId, tableNumber]) => {
    const numeric = Number(tableNumber)
    if (matchId && Number.isInteger(numeric) && numeric >= 1 && numeric <= tableCount) {
      next[matchId] = numeric
    }
    return next
  }, {})
}

export function createInitialState() {
  return {
    players: [],
    results: {},
    entriesMeta: {
      importedCount: 0,
      waitlistCount: 0,
      source: 'empty',
      importedAt: null,
    },
    tableCount: DEFAULT_TABLE_COUNT,
    tableAssignments: {},
    selectedMatchId: null,
    mode: 'operator',
    timer: null,
    lastFxEvent: null,
    updatedAt: new Date().toISOString(),
  }
}

export function normalizeState(value) {
  const fallback = createInitialState()
  if (!value || typeof value !== 'object') return fallback
  const tableCount = clampTableCount(value.tableCount ?? fallback.tableCount)

  return {
    players: Array.isArray(value.players) ? value.players : fallback.players,
    results: value.results && typeof value.results === 'object' ? value.results : {},
    entriesMeta:
      value.entriesMeta && typeof value.entriesMeta === 'object'
        ? { ...fallback.entriesMeta, ...value.entriesMeta }
        : fallback.entriesMeta,
    tableCount,
    tableAssignments: normalizeTableAssignments(value.tableAssignments, tableCount),
    selectedMatchId: value.selectedMatchId || fallback.selectedMatchId,
    mode: value.mode === 'spectator' ? 'spectator' : 'operator',
    timer: value.timer && typeof value.timer === 'object' ? value.timer : null,
    lastFxEvent: value.lastFxEvent && typeof value.lastFxEvent === 'object' ? value.lastFxEvent : null,
    updatedAt: value.updatedAt || fallback.updatedAt,
  }
}

function nextPowerOfTwo(value) {
  if (value <= MIN_BRACKET_SIZE) return MIN_BRACKET_SIZE
  return 2 ** Math.ceil(Math.log2(Math.min(value, MAX_PLAYERS)))
}

function getBracketSize(players) {
  const activeCount = players.filter((player) => player.active !== false && player.name).length
  return nextPowerOfTwo(activeCount)
}

function padSlots(players, bracketSize) {
  const activePlayers = players.filter((player) => player.active !== false && player.name).slice(0, MAX_PLAYERS)
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

function matchId(prefix, round, index) {
  return `${prefix}${round}-${index + 1}`
}

function generateMatchPlan(bracketSize) {
  const rounds = Math.log2(bracketSize)
  const plan = []

  for (let round = 1; round <= rounds; round += 1) {
    const count = bracketSize / 2 ** round
    for (let index = 0; index < count; index += 1) {
      plan.push({
        id: matchId('w', round, index),
        side: 'winners',
        round,
        index,
        roundTitle: round === rounds ? '勝者側決勝' : `ラウンド ${round}`,
        label: round === rounds ? 'WF' : `W${round}-${index + 1}`,
        name: round === rounds ? '勝者側 決勝' : `勝者側 R${round}-${index + 1}`,
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
        const previousMatch = (previousIndex) => matchId('l', previousRound, previousIndex)
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
          roundTitle: loserRound === rounds * 2 - 2 ? '敗者側決勝' : `ラウンド ${loserRound}`,
          label: loserRound === rounds * 2 - 2 ? 'LF' : `L${loserRound}-${index + 1}`,
          name: loserRound === rounds * 2 - 2 ? '敗者側 決勝' : `敗者側 R${loserRound}-${index + 1}`,
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
    roundTitle: 'グランドファイナル',
    label: 'GF',
    name: 'グランドファイナル',
    a: { winner: winnersFinalId },
    b: bracketSize === 2 ? { loser: winnersFinalId } : { winner: losersFinalId },
  })
  plan.push({
    id: 'gfr',
    side: 'finals',
    round: 2,
    index: 0,
    roundTitle: 'リセットファイナル',
    label: 'RESET',
    name: 'リセットファイナル',
    a: { winner: 'gf' },
    b: { loser: 'gf' },
    resetOnly: true,
  })

  return plan
}

function resolveSlot(slot, players, resultMap) {
  if ('seed' in slot) return players[slot.seed] || null

  const source = resultMap[slot.winner || slot.loser]
  if (!source?.winnerId) return null

  if ('winner' in slot) return players.find((player) => player.id === source.winnerId) || null
  const loserId = source.playerIds?.find((id) => id !== source.winnerId)
  return players.find((player) => player.id === loserId) || null
}

function describeSlot(slot) {
  if ('seed' in slot) return `Seed ${slot.seed + 1}`
  if ('winner' in slot) return `${slot.winner} 勝者`
  if ('loser' in slot) return `${slot.loser} 敗者`
  return '未定'
}

function getAutoWinner(playerA, playerB) {
  if (playerA?.active !== false && playerB?.bye) return playerA
  if (playerB?.active !== false && playerA?.bye) return playerB
  return null
}

function isResetNeeded(resultMap) {
  const grandFinal = resultMap.gf
  const grandFinalPlayers = grandFinal?.playerIds || []
  return Boolean(grandFinal?.winnerId && grandFinalPlayers.length === 2 && grandFinal.winnerId !== grandFinalPlayers[0])
}

export function buildBracket(state) {
  const cleanState = normalizeState(state)
  const bracketSize = getBracketSize(cleanState.players)
  const players = padSlots(cleanState.players, bracketSize)
  const plan = generateMatchPlan(bracketSize)
  const resultMap = {}
  const matches = []

  for (const item of plan) {
    if (item.resetOnly && !isResetNeeded(resultMap)) continue

    const playerA = resolveSlot(item.a, players, resultMap)
    const playerB = resolveSlot(item.b, players, resultMap)
    const autoWinner = getAutoWinner(playerA, playerB)
    const saved = cleanState.results[item.id]
    const ready = Boolean(playerA && playerB && !playerA.bye && !playerB.bye)
    const completed = Boolean(saved?.winnerId || autoWinner)
    const winnerId = saved?.winnerId || autoWinner?.id || null
    const playerIds = [playerA?.id, playerB?.id].filter((id) => id && !String(id).startsWith('bye-'))

    const match = {
      ...item,
      playerA,
      playerB,
      hintA: describeSlot(item.a),
      hintB: describeSlot(item.b),
      ready,
      completed,
      bye: Boolean(autoWinner && !saved?.winnerId),
      autoAdvanced: Boolean(autoWinner && !saved?.winnerId),
      scoreA: Number.isFinite(saved?.scoreA) ? saved.scoreA : '',
      scoreB: Number.isFinite(saved?.scoreB) ? saved.scoreB : '',
      winnerId,
      playerIds,
      tableNumber: Number(cleanState.tableAssignments[item.id]) || null,
    }

    if (completed) {
      resultMap[item.id] = {
        ...saved,
        winnerId,
        playerIds,
      }
    }

    matches.push(match)
  }

  const finalMatch = [...matches].reverse().find((match) => match.side === 'finals' && match.completed)
  const champion = finalMatch?.winnerId ? players.find((player) => player.id === finalMatch.winnerId) : null
  const manualMatches = matches.filter((match) => match.ready)
  const playableMatches = matches.filter((match) => !match.bye)
  const completedPlayableMatches = playableMatches.filter((match) => match.completed && !match.autoAdvanced)
  const nextMatch = manualMatches.find((match) => !match.completed) || null

  return {
    matches,
    champion,
    nextMatch,
    bracketSize,
    activeCount: players.filter((player) => player.active !== false && player.name && !player.bye).length,
    playerCount: players.filter((player) => player.active !== false && player.name && !player.bye).length,
    totalCount: playableMatches.length,
    completedCount: completedPlayableMatches.length,
    playOrder: playableMatches,
    progress: playableMatches.length ? completedPlayableMatches.length / playableMatches.length : 0,
  }
}

export function recordResult(state, matchId, winnerId, scoreA, scoreB, memo = '') {
  const bracket = buildBracket(state)
  const match = bracket.matches.find((item) => item.id === matchId)
  if (!match?.ready || !winnerId) return state
  if (!match.playerIds?.includes(winnerId)) return state

  const numericScoreA = Number(scoreA)
  const numericScoreB = Number(scoreB)
  if (!Number.isFinite(numericScoreA) || !Number.isFinite(numericScoreB)) return state
  if (numericScoreA < 0 || numericScoreB < 0) return state

  const nextResults = { ...state.results }
  const nextTableAssignments = { ...(state.tableAssignments || {}) }
  const changedIndex = bracket.matches.findIndex((item) => item.id === matchId)
  for (const item of bracket.matches.slice(changedIndex)) {
    delete nextResults[item.id]
  }
  // Only clear tables for matches whose results we invalidated.
  // Parallel in-progress matches later in bracket.matches must keep their tables.
  for (const item of bracket.matches.slice(changedIndex + 1)) {
    if (state.results[item.id]) {
      delete nextTableAssignments[item.id]
    }
  }

  nextResults[matchId] = {
    winnerId,
    scoreA: numericScoreA,
    scoreB: numericScoreB,
    playerIds: match.playerIds,
    memo: String(memo || '').slice(0, 500),
    recordedAt: new Date().toISOString(),
  }

  const winner = match.playerA?.id === winnerId ? match.playerA : match.playerB
  const fxVariant = match.id === 'gfr' ? 'reset' : match.side === 'finals' ? 'gf' : 'normal'

  const nextState = {
    ...state,
    results: nextResults,
    tableAssignments: nextTableAssignments,
    updatedAt: new Date().toISOString(),
    lastFxEvent: winner
      ? {
          matchId,
          name: winner.name,
          side: match.side,
          variant: fxVariant,
          at: Date.now(),
        }
      : state.lastFxEvent,
  }

  const nextBracket = buildBracket(nextState)
  return {
    ...nextState,
    selectedMatchId: nextBracket.nextMatch?.id || matchId,
  }
}

export function updatePlayerName(state, playerId, name) {
  return {
    ...state,
    players: state.players.map((player) => (player.id === playerId ? { ...player, name, active: Boolean(name) } : player)),
    results: {},
    tableAssignments: {},
    selectedMatchId: null,
    updatedAt: new Date().toISOString(),
  }
}

export function addPlayer(state, name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return state

  const activePlayers = state.players.filter((player) => player.active !== false && player.name)
  if (activePlayers.length >= MAX_PLAYERS) return state

  const nextId = state.players.reduce((max, player) => {
    const match = String(player.id).match(/^p(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)

  const newPlayer = {
    id: `p${nextId + 1}`,
    seed: state.players.length + 1,
    name: trimmed,
    active: true,
  }

  const entriesMeta = state.entriesMeta || {}
  const nextCount = activePlayers.length + 1

  return {
    ...state,
    players: [...state.players, newPlayer],
    results: {},
    tableAssignments: {},
    selectedMatchId: null,
    entriesMeta: {
      ...entriesMeta,
      importedCount: nextCount,
      source: entriesMeta.source === 'empty' ? '手動追加' : entriesMeta.source,
    },
    updatedAt: new Date().toISOString(),
  }
}

export function removePlayer(state, playerId) {
  if (!state.players.some((player) => player.id === playerId)) return state

  const remaining = state.players.filter((player) => player.id !== playerId)
  const activeCount = remaining.filter((player) => player.active !== false && player.name).length

  return {
    ...state,
    players: remaining.map((player, index) => ({ ...player, seed: index + 1 })),
    results: {},
    tableAssignments: {},
    selectedMatchId: null,
    entriesMeta: {
      ...(state.entriesMeta || {}),
      importedCount: activeCount,
    },
    updatedAt: new Date().toISOString(),
  }
}

function toPlayerSlots(entries) {
  return entries.slice(0, MAX_PLAYERS).map((entry, index) => ({
    id: `p${index + 1}`,
    seed: index + 1,
    name: entry.name,
    active: true,
    entry,
  }))
}

function shuffleArray(items) {
  const nextItems = [...items]
  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[nextItems[index], nextItems[target]] = [nextItems[target], nextItems[index]]
  }
  return nextItems
}

export function importEntries(state, entries, source = 'GoogleフォームCSV') {
  const accepted = entries.slice(0, MAX_PLAYERS)

  return {
    ...state,
    players: toPlayerSlots(accepted),
    results: {},
    tableAssignments: {},
    selectedMatchId: null,
    entriesMeta: {
      importedCount: accepted.length,
      waitlistCount: Math.max(entries.length - MAX_PLAYERS, 0),
      source,
      importedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  }
}

export function shufflePlayers(state) {
  const activeEntries = state.players
    .filter((player) => player.active !== false && player.name)
    .map((player) => player.entry || { name: player.name })

  return {
    ...state,
    players: toPlayerSlots(shuffleArray(activeEntries)),
    results: {},
    tableAssignments: {},
    selectedMatchId: null,
    entriesMeta: {
      ...(state.entriesMeta || {}),
      shuffledAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  }
}

export function clearResults(state) {
  return {
    ...state,
    results: {},
    tableAssignments: {},
    selectedMatchId: null,
    timer: null,
    lastFxEvent: null,
    updatedAt: new Date().toISOString(),
  }
}

export function updateTableCount(state, tableCount) {
  const nextTableCount = clampTableCount(tableCount)
  return {
    ...state,
    tableCount: nextTableCount,
    tableAssignments: normalizeTableAssignments(state.tableAssignments, nextTableCount),
    updatedAt: new Date().toISOString(),
  }
}

export function assignMatchTable(state, matchId, tableNumber) {
  const cleanState = normalizeState(state)
  const bracket = buildBracket(cleanState)
  const match = bracket.matches.find((item) => item.id === matchId)
  const numeric = Number(tableNumber)
  if (!match || !Number.isInteger(numeric) || numeric < 1 || numeric > cleanState.tableCount) return state
  if (!match.ready || match.completed || match.bye) return state

  const conflictsWithActiveMatch = bracket.matches.some((item) => {
    if (item.id === matchId || !item.ready || item.completed || item.bye) return false
    return Number(cleanState.tableAssignments[item.id]) === numeric
  })
  if (conflictsWithActiveMatch) return state

  return {
    ...state,
    tableCount: cleanState.tableCount,
    tableAssignments: {
      ...cleanState.tableAssignments,
      [matchId]: numeric,
    },
    updatedAt: new Date().toISOString(),
  }
}

export function getMatchColumns(matches, side) {
  return matches
    .filter((match) => match.side === side)
    .reduce((columns, match) => {
      const key = String(match.round)
      columns[key] = [...(columns[key] || []), match]
      return columns
    }, {})
}
