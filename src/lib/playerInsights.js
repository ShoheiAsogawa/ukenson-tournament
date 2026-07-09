const DEFAULT_MATCH_MINUTES = 8
/** Wait ETA assumes this many tables running in parallel (venue default). */
const WAIT_ESTIMATE_TABLES = 6
const MIN_MATCH_MINUTES = 5
const MAX_MATCH_MINUTES = 15

function sideLabel(side) {
  if (side === 'winners') return '勝者側'
  if (side === 'losers') return '敗者側'
  if (side === 'finals') return '決勝'
  return '試合'
}

function clampMatchMinutes(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_MATCH_MINUTES
  return Math.max(MIN_MATCH_MINUTES, Math.min(MAX_MATCH_MINUTES, Math.round(numeric)))
}

export function findPlayersByQuery(players, query) {
  const normalized = String(query || '')
    .trim()
    .toLowerCase()
  if (!normalized) return []

  return players.filter(
    (player) => player.active !== false && player.name && player.name.toLowerCase().includes(normalized),
  )
}

export function findPlayerNextMatch(playerId, bracket) {
  for (const match of bracket.playOrder || []) {
    if (match.completed || match.bye) continue
    if (match.playerA?.id === playerId || match.playerB?.id === playerId) {
      return match
    }
  }
  return null
}

export function findPlayerLastMatch(playerId, bracket, state) {
  const completed = (bracket.matches || [])
    .filter(
      (match) =>
        match.completed &&
        !match.bye &&
        (match.playerA?.id === playerId || match.playerB?.id === playerId) &&
        state.results?.[match.id],
    )
    .sort(
      (a, b) =>
        new Date(state.results[b.id].recordedAt || 0).getTime() -
        new Date(state.results[a.id].recordedAt || 0).getTime(),
    )

  return completed[0] || null
}

export function countMatchesUntil(playerId, bracket) {
  const upcoming = findPlayerNextMatch(playerId, bracket)
  if (!upcoming) return null

  let count = 0
  for (const match of bracket.playOrder || []) {
    if (match.id === upcoming.id) break
    if (!match.completed) count += 1
  }
  return count
}

export function estimateAvgMatchMinutes(state, bracket, tableCount = WAIT_ESTIMATE_TABLES) {
  const tables = Math.max(1, Number(tableCount) || WAIT_ESTIMATE_TABLES)
  const timestamps = (bracket.matches || [])
    .filter((match) => match.completed && !match.autoAdvanced && state.results?.[match.id]?.recordedAt)
    .map((match) => new Date(state.results[match.id].recordedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b)

  if (timestamps.length < 2) return DEFAULT_MATCH_MINUTES

  // Completions arrive in parallel waves. Mean gap between finishes is ~matchDuration / tables.
  // Recover wall-clock match length: avgGap * tables.
  let totalGap = 0
  let gapCount = 0
  for (let index = 1; index < timestamps.length; index += 1) {
    const gap = timestamps[index] - timestamps[index - 1]
    // Ignore multi-hour pauses / overnight gaps.
    if (gap <= 0 || gap > 45 * 60_000) continue
    totalGap += gap
    gapCount += 1
  }

  if (!gapCount) return DEFAULT_MATCH_MINUTES

  const avgGapMinutes = totalGap / gapCount / 60_000
  return clampMatchMinutes(avgGapMinutes * tables)
}

export function estimateWaitMinutes(matchesUntil, avgMinutes, tableCount = WAIT_ESTIMATE_TABLES) {
  if (matchesUntil === null || matchesUntil <= 0) return null
  const tables = Math.max(1, Number(tableCount) || WAIT_ESTIMATE_TABLES)
  const matchMinutes = clampMatchMinutes(avgMinutes)
  // With N tables, the queue drains ~N matches per match-duration.
  const center = (matchesUntil / tables) * matchMinutes
  // Tight band around the parallelized ETA (±15–25%), never below 1 minute.
  const minWait = Math.max(1, Math.round(center * 0.85))
  const maxWait = Math.max(minWait, Math.round(center * 1.25))
  return { minWait, maxWait, tables, matchMinutes }
}

export function formatWaitEstimate(matchesUntil, avgMinutes, tableCount = WAIT_ESTIMATE_TABLES) {
  if (matchesUntil === null) return null
  if (matchesUntil === 0) return 'まもなく呼び出し'
  const estimate = estimateWaitMinutes(matchesUntil, avgMinutes, tableCount)
  if (!estimate) return `あと${matchesUntil}試合`
  const { minWait, maxWait } = estimate
  if (minWait === maxWait) {
    return `あと${matchesUntil}試合（おおよそ ${minWait}分後）`
  }
  return `あと${matchesUntil}試合（おおよそ ${minWait}〜${maxWait}分後）`
}

export function getPlayerStatus(playerId, state, bracket) {
  if (bracket.champion?.id === playerId) {
    return { type: 'champion', label: '優勝', tone: 'gold' }
  }

  const upcoming = findPlayerNextMatch(playerId, bracket)
  if (upcoming) {
    const sideText = sideLabel(upcoming.side)
    const roundText = upcoming.roundTitle || upcoming.name
    if (upcoming.ready) {
      return {
        type: upcoming.side === 'finals' ? 'finals' : upcoming.side,
        label: `${sideText} ${roundText}（次の自分の試合）`,
        tone: upcoming.side === 'finals' ? 'gold' : upcoming.side === 'losers' ? 'ember' : 'cyan',
      }
    }
    return {
      type: 'waiting',
      label: `${sideText} ${roundText} 待機中`,
      tone: 'muted',
    }
  }

  const lastMatch = findPlayerLastMatch(playerId, bracket, state)
  if (!lastMatch) {
    return { type: 'registered', label: '参加登録済み（試合未開始）', tone: 'muted' }
  }

  if (lastMatch.winnerId === playerId) {
    return { type: 'waiting', label: '前試合勝利 — 次戦枠待ち', tone: 'cyan' }
  }

  return { type: 'eliminated', label: '敗退', tone: 'danger' }
}

export function getPlayerPositionLabel(playerId, state, bracket) {
  const upcoming = findPlayerNextMatch(playerId, bracket)
  if (upcoming) {
    return `${sideLabel(upcoming.side)} ${upcoming.roundTitle || upcoming.name}`
  }

  const lastMatch = findPlayerLastMatch(playerId, bracket, state)
  if (lastMatch) {
    if (lastMatch.winnerId === playerId) {
      return `${sideLabel(lastMatch.side)} ${lastMatch.roundTitle || lastMatch.name} 勝利`
    }
    return `${sideLabel(lastMatch.side)} ${lastMatch.roundTitle || lastMatch.name} 敗退`
  }

  return '試合開始前'
}

export function getNextOpponent(playerId, bracket) {
  const upcoming = findPlayerNextMatch(playerId, bracket)
  if (!upcoming?.ready) return null

  if (upcoming.playerA?.id === playerId) return upcoming.playerB
  if (upcoming.playerB?.id === playerId) return upcoming.playerA
  return null
}

export function buildPlayerStats(playerId, state, bracket) {
  const matches = (bracket.matches || []).filter(
    (match) =>
      match.completed &&
      !match.bye &&
      (match.playerA?.id === playerId || match.playerB?.id === playerId),
  )

  const player = state.players.find((item) => item.id === playerId)
  let wins = 0
  let losses = 0
  let upsets = 0
  let totalGames = 0
  let scoreDiff = 0
  let winScoreTotal = 0
  let winMarginTotal = 0
  let dominantWins = 0
  let closeWins = 0

  for (const match of matches) {
    const won = match.winnerId === playerId
    const isPlayerA = match.playerA?.id === playerId
    const playerScore = Number(isPlayerA ? match.scoreA : match.scoreB) || 0
    const opponentScore = Number(isPlayerA ? match.scoreB : match.scoreA) || 0
    const margin = playerScore - opponentScore
    if (won) wins += 1
    else losses += 1
    totalGames += (Number(match.scoreA) || 0) + (Number(match.scoreB) || 0)
    scoreDiff += margin

    if (won) {
      winScoreTotal += playerScore
      winMarginTotal += margin
      if (margin >= 2 || opponentScore === 0) dominantWins += 1
      if (margin === 1) closeWins += 1

      const opponent = match.playerA?.id === playerId ? match.playerB : match.playerA
      if (player?.seed && opponent?.seed && opponent.seed < player.seed) {
        upsets += 1
      }
    }
  }

  const sorted = [...matches].sort(
    (a, b) =>
      new Date(state.results?.[b.id]?.recordedAt || 0).getTime() -
      new Date(state.results?.[a.id]?.recordedAt || 0).getTime(),
  )

  let winStreak = 0
  for (const match of sorted) {
    if (match.winnerId === playerId) winStreak += 1
    else break
  }

  return {
    wins,
    losses,
    upsets,
    totalGames,
    scoreDiff,
    winScoreTotal,
    winMarginTotal,
    dominantWins,
    closeWins,
    winStreak,
    matchesPlayed: matches.length,
  }
}

export function buildPlayerProfile(player, state, bracket) {
  const status = getPlayerStatus(player.id, state, bracket)
  const matchesUntil = countMatchesUntil(player.id, bracket)
  const avgMinutes = estimateAvgMatchMinutes(state, bracket, WAIT_ESTIMATE_TABLES)
  const lastMatch = findPlayerLastMatch(player.id, bracket, state)
  const nextOpponent = getNextOpponent(player.id, bracket)

  return {
    player,
    status,
    position: getPlayerPositionLabel(player.id, state, bracket),
    nextOpponent,
    matchesUntil,
    waitEstimate: formatWaitEstimate(matchesUntil, avgMinutes, WAIT_ESTIMATE_TABLES),
    lastMatch,
    lastResult: lastMatch
      ? {
          label: lastMatch.label,
          name: lastMatch.name,
          score: `${lastMatch.scoreA} - ${lastMatch.scoreB}`,
          won: lastMatch.winnerId === player.id,
          opponent:
            lastMatch.playerA?.id === player.id ? lastMatch.playerB?.name : lastMatch.playerA?.name,
        }
      : null,
    stats: buildPlayerStats(player.id, state, bracket),
  }
}

export function getTournamentHighlights(state, bracket) {
  const activePlayers = state.players.filter((player) => player.active !== false && player.name)

  const profiles = activePlayers.map((player) => ({
    player,
    stats: buildPlayerStats(player.id, state, bracket),
    status: getPlayerStatus(player.id, state, bracket),
  }))

  const alive = profiles.filter((item) => item.status.type !== 'eliminated' && item.status.type !== 'registered')

  const byStreak = [...profiles].sort((a, b) => b.stats.winStreak - a.stats.winStreak)
  const byUpsets = [...profiles].sort((a, b) => b.stats.upsets - a.stats.upsets)
  const byGames = [...profiles].sort((a, b) => b.stats.totalGames - a.stats.totalGames)

  const candidates = alive
    .filter((item) => item.status.type !== 'champion')
    .sort((a, b) => a.player.seed - b.player.seed)
    .map((item, index) => ({
      rank: index + 1,
      player: item.player,
      status: item.status,
      stats: item.stats,
    }))

  return {
    topStreak: byStreak[0]?.stats.winStreak ? byStreak[0] : null,
    topUpsets: byUpsets[0]?.stats.upsets ? byUpsets[0] : null,
    topGames: byGames[0]?.stats.totalGames ? byGames[0] : null,
    candidates,
    aliveCount: alive.length,
    avgMatchMinutes: estimateAvgMatchMinutes(state, bracket),
  }
}

function latestRecordedAt(match, state) {
  return new Date(state.results?.[match.id]?.recordedAt || 0).getTime()
}

function playerIsOnLosersSide(playerId, bracket) {
  return (bracket.playOrder || []).some(
    (match) =>
      !match.completed &&
      match.side === 'losers' &&
      (match.playerA?.id === playerId || match.playerB?.id === playerId),
  )
}

function playerIsAlive(status) {
  return status.type !== 'eliminated' && status.type !== 'registered'
}

function isFullSetMatch(match) {
  const scoreA = Number(match.scoreA)
  const scoreB = Number(match.scoreB)
  if (!match.completed || match.bye || !Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return false
  const winnerScore = Math.max(scoreA, scoreB)
  const loserScore = Math.min(scoreA, scoreB)
  return winnerScore >= 2 && loserScore >= 1 && winnerScore - loserScore === 1
}

function buildPlayerBadgeFromStats(stats, status, onLosersSide) {
  if (!playerIsAlive(status)) return null

  const badges = []

  if (onLosersSide) {
    badges.push({ type: 'survivor', label: '復活中', title: '敗者側から復活中', priority: 100 })
  }
  if (stats.winStreak >= 2) {
    badges.push({
      type: 'streak',
      label: `${stats.winStreak}連勝`,
      title: `${stats.winStreak}連勝中`,
      priority: 92,
    })
  }
  if (stats.closeWins >= 2) {
    badges.push({ type: 'clutch', label: '接戦強者', title: '接戦を勝ち切っています', priority: 72 })
  }

  return badges.sort((a, b) => b.priority - a.priority)[0] || null
}

function buildPlayerStatsThroughMatch(player, currentMatch, completedMatches, state) {
  const currentRecordedAt = latestRecordedAt(currentMatch, state)
  const scopedState = {
    ...state,
    results: Object.fromEntries(
      completedMatches
        .filter((match) => {
          if (currentMatch.completed && currentRecordedAt > 0) {
            return latestRecordedAt(match, state) <= currentRecordedAt
          }
          return true
        })
        .map((match) => [match.id, state.results[match.id]]),
    ),
  }
  const scopedBracket = {
    matches: completedMatches.filter((match) => scopedState.results[match.id]),
  }
  return buildPlayerStats(player.id, scopedState, scopedBracket)
}

export function buildTournamentBadges(state, bracket) {
  const players = {}
  const survivorPlayerIds = new Set()
  const completedMatches = (bracket.matches || []).filter(
    (match) => match.completed && !match.bye && state.results?.[match.id],
  )

  for (const player of state.players || []) {
    if (player.active === false || !player.name) continue

    const status = getPlayerStatus(player.id, state, bracket)
    if (!playerIsAlive(status)) continue

    const currentStats = buildPlayerStats(player.id, state, bracket)
    if (playerIsOnLosersSide(player.id, bracket) || currentStats.losses > 0) survivorPlayerIds.add(player.id)
  }

  const matches = {}
  for (const match of bracket.matches || []) {
    const badges = []
    const hasSurvivor = [match.playerA?.id, match.playerB?.id].some((id) => survivorPlayerIds.has(id))

    if (isFullSetMatch(match)) {
      badges.push({ type: 'full-set', label: '名勝負', title: 'フルセットの接戦' })
    }
    if (hasSurvivor && match.side === 'losers' && !match.bye) {
      badges.push({ type: 'survivor-match', label: 'REVIVAL', title: '敗者側サバイバー' })
    }

    if (badges.length) matches[match.id] = badges

    const playerEntries = [match.playerA, match.playerB].filter((player) => player && !player.bye)
    for (const player of playerEntries) {
      const status = getPlayerStatus(player.id, state, bracket)
      if (!playerIsAlive(status)) continue

      const stats = match.completed
        ? buildPlayerStatsThroughMatch(player, match, completedMatches, state)
        : buildPlayerStats(player.id, state, bracket)
      const onLosersSide = survivorPlayerIds.has(player.id) && (match.side !== 'winners' || stats.losses > 0)
      const badge = buildPlayerBadgeFromStats(stats, status, onLosersSide)
      if (!badge) continue

      if (!players[match.id]) players[match.id] = {}
      players[match.id][player.id] = badge
    }
  }

  return { players, matches }
}

export function buildFeaturedPlayers(state, bracket) {
  const activePlayers = state.players.filter((player) => player.active !== false && player.name)
  const latestCompletedAt = Math.max(
    0,
    ...(bracket.matches || [])
      .filter((match) => match.completed && !match.bye && state.results?.[match.id])
      .map((match) => latestRecordedAt(match, state)),
  )

  const rows = activePlayers.map((player) => {
    const stats = buildPlayerStats(player.id, state, bracket)
    const status = getPlayerStatus(player.id, state, bracket)
    const upcoming = findPlayerNextMatch(player.id, bracket)
    const matchesUntil = countMatchesUntil(player.id, bracket)
    const lastMatch = findPlayerLastMatch(player.id, bracket, state)
    const lastWon = lastMatch?.winnerId === player.id
    const recentWin =
      lastWon && latestCompletedAt > 0 && latestRecordedAt(lastMatch, state) >= latestCompletedAt - 1000 * 60 * 30
    const onLosersSide = playerIsOnLosersSide(player.id, bracket)
    const readyBonus = upcoming?.ready ? 42 : 0
    const queueBonus = matchesUntil === null ? 0 : Math.max(0, 36 - matchesUntil * 7)
    const losersBonus = onLosersSide && status.type !== 'eliminated' ? 28 : 0
    const eliminatedPenalty = status.type === 'eliminated' ? 55 : 0
    const registeredPenalty = status.type === 'registered' ? 10 : 0
    const scorePerformanceBonus =
      stats.scoreDiff * 2.2 + stats.winMarginTotal * 1.4 + stats.dominantWins * 7 + stats.closeWins * 3
    const score =
      readyBonus +
      queueBonus +
      stats.winStreak * 10 +
      stats.upsets * 9 +
      stats.wins * 4 +
      stats.totalGames * 0.25 +
      scorePerformanceBonus +
      (recentWin ? 16 : 0) +
      (lastWon ? 6 : 0) +
      losersBonus -
      eliminatedPenalty -
      registeredPenalty -
      (player.seed || 0) * 0.05

    return {
      player,
      stats,
      status,
      upcoming,
      matchesUntil,
      lastMatch,
      onLosersSide,
      score,
    }
  })

  rows.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if ((a.matchesUntil ?? 999) !== (b.matchesUntil ?? 999)) return (a.matchesUntil ?? 999) - (b.matchesUntil ?? 999)
    if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins
    if (a.stats.losses !== b.stats.losses) return a.stats.losses - b.stats.losses
    return a.player.seed - b.player.seed
  })

  return rows.slice(0, 8).map((row, index) => ({ ...row, focusRank: index + 1 }))
}

// Live standings for every entrant. Recomputed on each state change, so the
// order shifts in real time as results are recorded.
// Tiers: champion > still alive > eliminated.
// - Alive: more wins first, fewer losses (winners side) first.
// - Eliminated: the later in the bracket you fell, the higher you stand.
export function buildLiveRanking(state, bracket) {
  const activePlayers = state.players.filter((player) => player.active !== false && player.name)
  const matchOrder = new Map((bracket.matches || []).map((match, index) => [match.id, index]))

  const rows = activePlayers.map((player) => {
    const stats = buildPlayerStats(player.id, state, bracket)
    const status = getPlayerStatus(player.id, state, bracket)
    const tier = status.type === 'champion' ? 3 : status.type === 'eliminated' ? 1 : 2

    let elimDepth = -1
    if (tier === 1) {
      for (const match of bracket.matches || []) {
        if (!match.completed || match.bye) continue
        const involved = match.playerA?.id === player.id || match.playerB?.id === player.id
        if (involved && match.winnerId && match.winnerId !== player.id) {
          elimDepth = Math.max(elimDepth, matchOrder.get(match.id) ?? 0)
        }
      }
    }

    return { player, stats, status, tier, elimDepth }
  })

  rows.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier
    if (a.tier === 1) {
      if (a.elimDepth !== b.elimDepth) return b.elimDepth - a.elimDepth
      if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins
      if (a.stats.scoreDiff !== b.stats.scoreDiff) return b.stats.scoreDiff - a.stats.scoreDiff
      return a.player.seed - b.player.seed
    }
    // Alive players: wins > losses > score differential > games won > dominant wins > seed
    if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins
    if (a.stats.losses !== b.stats.losses) return a.stats.losses - b.stats.losses
    if (a.stats.scoreDiff !== b.stats.scoreDiff) return b.stats.scoreDiff - a.stats.scoreDiff
    if (a.stats.winScoreTotal !== b.stats.winScoreTotal) return b.stats.winScoreTotal - a.stats.winScoreTotal
    if (a.stats.dominantWins !== b.stats.dominantWins) return b.stats.dominantWins - a.stats.dominantWins
    if (a.stats.upsets !== b.stats.upsets) return b.stats.upsets - a.stats.upsets
    return a.player.seed - b.player.seed
  })

  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

export function isGrandFinalsPhase(bracket) {
  const grandFinal = bracket.matches?.find((match) => match.id === 'gf')
  const resetFinal = bracket.matches?.find((match) => match.id === 'gfr')
  if (bracket.champion) return false
  return Boolean(
    (grandFinal && (grandFinal.ready || grandFinal.completed)) ||
      (resetFinal && (resetFinal.ready || resetFinal.completed)),
  )
}

export function isResetFinalActive(bracket) {
  const resetFinal = bracket.matches?.find((match) => match.id === 'gfr')
  return Boolean(resetFinal?.ready && !resetFinal.completed)
}
