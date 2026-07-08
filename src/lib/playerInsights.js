const DEFAULT_MATCH_MINUTES = 8

function sideLabel(side) {
  if (side === 'winners') return '勝者側'
  if (side === 'losers') return '敗者側'
  if (side === 'finals') return '決勝'
  return '試合'
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

export function estimateAvgMatchMinutes(state, bracket) {
  const timestamps = (bracket.matches || [])
    .filter((match) => match.completed && !match.autoAdvanced && state.results?.[match.id]?.recordedAt)
    .map((match) => new Date(state.results[match.id].recordedAt).getTime())
    .sort((a, b) => a - b)

  if (timestamps.length < 2) return DEFAULT_MATCH_MINUTES

  let totalGap = 0
  for (let index = 1; index < timestamps.length; index += 1) {
    totalGap += timestamps[index] - timestamps[index - 1]
  }

  const avgMinutes = Math.round(totalGap / (timestamps.length - 1) / 60000)
  return Math.max(5, Math.min(15, avgMinutes || DEFAULT_MATCH_MINUTES))
}

export function formatWaitEstimate(matchesUntil, avgMinutes) {
  if (matchesUntil === null) return null
  if (matchesUntil === 0) return 'まもなく呼び出し'
  const minWait = matchesUntil * avgMinutes
  const maxWait = matchesUntil * (avgMinutes + 2)
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
  const avgMinutes = estimateAvgMatchMinutes(state, bracket)
  const lastMatch = findPlayerLastMatch(player.id, bracket, state)
  const nextOpponent = getNextOpponent(player.id, bracket)

  return {
    player,
    status,
    position: getPlayerPositionLabel(player.id, state, bracket),
    nextOpponent,
    matchesUntil,
    waitEstimate: formatWaitEstimate(matchesUntil, avgMinutes),
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
      return a.player.seed - b.player.seed
    }
    if (a.stats.wins !== b.stats.wins) return b.stats.wins - a.stats.wins
    if (a.stats.losses !== b.stats.losses) return a.stats.losses - b.stats.losses
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
