import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  Clipboard,
  Crown,
  ExternalLink,
  Eye,
  Flame,
  History,
  LayoutDashboard,
  ListOrdered,
  Minus,
  MonitorPlay,
  Play,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Settings2,
  Shuffle,
  Sparkles,
  Swords,
  Timer,
  Trash2,
  Trophy,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import logoTransparent from './assets/brand/ukenson-logo-transparent.webp'
import featuredPlayersTemplate from './assets/brand/featured-players-template.webp'
import rankingTemplate from './assets/brand/ranking-template.webp'
import './App.css'
import {
  addPlayer,
  buildBracket,
  clearResults,
  createInitialState,
  importEntries,
  MAX_PLAYERS,
  recordResult,
  removePlayer,
  shufflePlayers,
  updatePlayerName,
} from './lib/tournamentEngine'
import ShareCardButton from './components/ShareCardButton'
import {
  buildFeaturedPlayers,
  buildLiveRanking,
  buildPlayerProfile,
  buildTournamentBadges,
  findPlayersByQuery,
  isGrandFinalsPhase,
  isResetFinalActive,
} from './lib/playerInsights'
import { parseEntryText } from './lib/entryImport'
import {
  hasSupabaseConfig,
  loadTournamentState,
  saveTournamentState,
  subscribeTournamentState,
  verifyAdminPin,
} from './lib/supabaseStore'

const BOARD_IMAGE_PRELOADS = [featuredPlayersTemplate, rankingTemplate]

function warmImage(src) {
  const image = new Image()
  image.decoding = 'async'
  image.fetchPriority = 'low'
  image.src = src
}

function scheduleBoardImageWarmup() {
  const warmup = () => BOARD_IMAGE_PRELOADS.forEach(warmImage)
  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(warmup, { timeout: 1800 })
    return () => window.cancelIdleCallback(idleId)
  }
  const timeoutId = window.setTimeout(warmup, 900)
  return () => window.clearTimeout(timeoutId)
}

/* ---------------------------------------------------------------- */
/* Bracket geometry (computed from the generated bracket)            */
/* ---------------------------------------------------------------- */

const CARD_W = 216
const CARD_H = 98
const PAD = 24
const GAP_Y = 34
const COL_W = CARD_W + 60
const SECTION_GAP = 104
const MATCH_NAME_MAX_LENGTH = 12
const MATCH_NAME_COMPACT_LENGTH = 9

function getMatchDisplayName(name) {
  const chars = Array.from(name || '')
  if (chars.length >= MATCH_NAME_MAX_LENGTH) return `${chars.slice(0, MATCH_NAME_MAX_LENGTH - 1).join('')}…`
  return name
}

function groupRounds(list) {
  const rounds = new Map()
  for (const match of list) {
    if (!rounds.has(match.round)) rounds.set(match.round, [])
    rounds.get(match.round).push(match)
  }
  for (const items of rounds.values()) items.sort((a, b) => a.index - b.index)
  return rounds
}

function computeLayout(matches) {
  const byId = Object.fromEntries(matches.map((match) => [match.id, match]))
  const pos = {}
  const labels = []
  const winners = matches.filter((match) => match.side === 'winners')
  const losers = matches.filter((match) => match.side === 'losers')

  const wRounds = groupRounds(winners)
  const wHeadY = 66
  for (const match of wRounds.get(1) || []) {
    pos[match.id] = [PAD, wHeadY + match.index * (CARD_H + GAP_Y)]
  }
  for (let round = 2; round <= wRounds.size; round += 1) {
    for (const match of wRounds.get(round) || []) {
      const ya = pos[match.a.winner]?.[1] ?? wHeadY
      const yb = pos[match.b.winner]?.[1] ?? ya
      pos[match.id] = [PAD + (round - 1) * COL_W, (ya + yb) / 2]
    }
  }
  let wBottom = wHeadY
  for (const match of winners) wBottom = Math.max(wBottom, pos[match.id][1] + CARD_H)
  for (const [round, items] of wRounds) {
    labels.push({ x: PAD + (round - 1) * COL_W, y: wHeadY - 26, text: items[0].roundTitle, side: 'winners' })
  }

  const lTop = wBottom + SECTION_GAP
  const lHeadY = lTop + 62
  const lRounds = groupRounds(losers)
  for (const match of lRounds.get(1) || []) {
    pos[match.id] = [PAD, lHeadY + match.index * (CARD_H + GAP_Y)]
  }
  for (let round = 2; round <= lRounds.size; round += 1) {
    for (const match of lRounds.get(round) || []) {
      const aPos = match.a.winner ? pos[match.a.winner] : null
      const bPos = match.b.winner ? pos[match.b.winner] : null
      const y = aPos && bPos ? (aPos[1] + bPos[1]) / 2 : (aPos?.[1] ?? bPos?.[1] ?? lHeadY)
      pos[match.id] = [PAD + (round - 1) * COL_W, y]
    }
  }
  let lBottom = lTop
  for (const match of losers) lBottom = Math.max(lBottom, pos[match.id][1] + CARD_H)
  for (const [round, items] of lRounds) {
    labels.push({ x: PAD + (round - 1) * COL_W, y: lHeadY - 26, text: items[0].roundTitle, side: 'losers' })
  }

  const wFinal = (wRounds.get(wRounds.size) || [])[0]
  const lFinal = (lRounds.get(lRounds.size) || [])[0]
  const gfX = PAD + Math.max(wRounds.size, lRounds.size) * COL_W
  const wfY = wFinal ? pos[wFinal.id][1] : wHeadY
  const lfY = lFinal ? pos[lFinal.id][1] : wfY
  const gfY = (wfY + lfY) / 2
  if (byId.gf) pos.gf = [gfX, gfY]
  if (byId.gfr) pos.gfr = [gfX, gfY + CARD_H + 44]
  labels.push({ x: gfX, y: gfY - 26, text: 'グランドファイナル', side: 'finals' })

  const champPlate = {
    x: gfX,
    y: (byId.gfr ? pos.gfr[1] : gfY) + CARD_H + 30,
  }

  const links = []
  for (const match of matches) {
    for (const slotKey of ['a', 'b']) {
      const ref = match[slotKey].winner
      if (!ref || !pos[ref] || !pos[match.id] || !byId[ref]) continue
      if (byId[ref].side !== match.side && match.side !== 'finals') continue
      links.push({
        from: ref,
        to: match.id,
        slot: slotKey,
        tone: match.side === 'finals' ? 'gold' : match.side === 'winners' ? 'cyan' : 'ember',
      })
    }
  }

  return {
    pos,
    links,
    labels,
    badges: { winners: { x: PAD, y: wHeadY - 62 }, losers: { x: PAD, y: lTop } },
    champPlate,
    width: gfX + CARD_W + PAD,
    height: Math.max(lBottom, champPlate.y + 96) + PAD,
  }
}

const NAV_ITEMS = [
  { id: 'bracket', label: 'トーナメント表', icon: LayoutDashboard },
  { id: 'lookup', label: 'YOUR MATCH', icon: Search },
  { id: 'highlights', label: '注目選手', icon: Sparkles },
  { id: 'ranking', label: 'ランキング', icon: Crown },
  { id: 'matches', label: '試合一覧', icon: ListOrdered },
  { id: 'players', label: '選手一覧', icon: Users },
  { id: 'cards', label: '対戦カード管理', icon: Swords },
  { id: 'history', label: '結果履歴', icon: History },
  { id: 'broadcast', label: '配信・画面出力', icon: MonitorPlay },
  { id: 'settings', label: '設定', icon: Settings2 },
]

const PUBLIC_NAV_ITEMS = [
  { id: 'bracket', label: 'トーナメント表', icon: Trophy, primary: true },
  { id: 'lookup', label: '検索', icon: Search },
  { id: 'highlights', label: '注目選手', icon: Sparkles },
  { id: 'ranking', label: 'ランキング', icon: Crown },
]
const PUBLIC_VIEW_IDS = new Set(PUBLIC_NAV_ITEMS.map((item) => item.id))

function getInitialPublicView(forcePlayerPage) {
  const params = new URLSearchParams(window.location.search)
  const requestedTab = params.get('tab')
  if (PUBLIC_VIEW_IDS.has(requestedTab)) return requestedTab
  return forcePlayerPage ? 'lookup' : 'bracket'
}

function slotAnchorOffset(slot) {
  if (slot === 'a') return CARD_H * 0.45
  if (slot === 'b') return CARD_H * 0.74
  return CARD_H * 0.5
}

function winnerSlot(match) {
  if (!match?.winnerId) return null
  if (match.playerA?.id === match.winnerId) return 'a'
  if (match.playerB?.id === match.winnerId) return 'b'
  return null
}

function wirePath(fromPos, toPos, slot, sourceSlot) {
  const x1 = fromPos[0] + CARD_W
  const y1 = fromPos[1] + slotAnchorOffset(sourceSlot)
  const x2 = toPos[0]
  const y2 = toPos[1] + slotAnchorOffset(slot)
  const mid = x1 + Math.max((x2 - x1) * 0.5, 18)
  return `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`
}

function formatClock(startedAt, now) {
  if (!startedAt) return '00:00'
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

const MOBILE_MEDIA_QUERY = '(max-width: 900px)'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_MEDIA_QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = (event) => setIsMobile(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

/* ---------------------------------------------------------------- */
/* Root                                                              */
/* ---------------------------------------------------------------- */

function App() {
  if (window.location.hash.includes('overlay')) {
    return <BroadcastOverlay />
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('view') === 'player') {
    return <ControlRoom forceSpectator forcePlayerPage />
  }
  if (params.get('view') === 'spectator') {
    return <ControlRoom forceSpectator />
  }
  return <AdminGate />
}

const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || 'ukenson2026'
const ADMIN_AUTH_KEY = 'ukenson-admin-authed'
const ADMIN_PIN_SESSION_KEY = 'ukenson-admin-pin'

function AdminGate() {
  const serverVerifiedAdmin = hasSupabaseConfig && !import.meta.env.VITE_ADMIN_PIN
  const [authed, setAuthed] = useState(() => {
    try {
      const hasAuth = window.sessionStorage.getItem(ADMIN_AUTH_KEY) === 'true'
      const hasServerPin = Boolean(window.sessionStorage.getItem(ADMIN_PIN_SESSION_KEY))
      return hasAuth && (!serverVerifiedAdmin || hasServerPin)
    } catch {
      return false
    }
  })
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [operatorPin, setOperatorPin] = useState(() => {
    try {
      return window.sessionStorage.getItem(ADMIN_PIN_SESSION_KEY) || ''
    } catch {
      return ''
    }
  })

  if (authed) return <ControlRoom operatorPin={operatorPin} />

  const handleSubmit = async (event) => {
    event.preventDefault()
    setChecking(true)
    setError('')
    try {
      const ok = serverVerifiedAdmin ? await verifyAdminPin(pin) : pin === ADMIN_PIN
      if (!ok) throw new Error('invalid pin')
      try {
        window.sessionStorage.setItem(ADMIN_AUTH_KEY, 'true')
        window.sessionStorage.setItem(ADMIN_PIN_SESSION_KEY, pin)
      } catch {
        // ignore storage errors
      }
      setOperatorPin(pin)
      setAuthed(true)
      setError('')
    } catch {
      setError('パスコードが違います')
      setPin('')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="admin-gate">
      <form className="admin-gate-card" onSubmit={handleSubmit}>
        <h1>運営ログイン</h1>
        <p>管理画面にアクセスするにはパスコードを入力してください。</p>
        {!hasSupabaseConfig && (
          <p className="admin-gate-error">
            Supabase環境変数が未設定です。このままだと端末内デモ保存になり、他端末へ同期されません。
          </p>
        )}
        <input
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="パスコード"
          autoFocus
        />
        {error && <p className="admin-gate-error">{error}</p>}
        <button type="submit" disabled={checking}>{checking ? '確認中...' : '入室する'}</button>
      </form>
    </div>
  )
}

function ControlRoom({ forceSpectator = false, forcePlayerPage = false, operatorPin = '' } = {}) {
  const [state, setState] = useState(createInitialState)
  const [loadStatus, setLoadStatus] = useState('loading')
  const [saveStatus, setSaveStatus] = useState('ready')
  const [isPending, startTransition] = useTransition()
  const [view, setView] = useState(() => (forceSpectator ? getInitialPublicView(forcePlayerPage) : 'bracket'))
  const [publicSelectedMatchId, setPublicSelectedMatchId] = useState(null)
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [fx, setFx] = useState(null)
  const isMobile = useIsMobile()
  const [resultSheetOpen, setResultSheetOpen] = useState(false)
  const [resultPreviewMatchId, setResultPreviewMatchId] = useState(null)
  const lastFxAtRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => scheduleBoardImageWarmup(), [])

  useEffect(() => {
    let live = true
    loadTournamentState()
      .then((payload) => {
        if (!live) return
        setState(payload)
        setLoadStatus('ready')
      })
      .catch(() => setLoadStatus('offline'))

    const unsubscribe = subscribeTournamentState((payload) => {
      if (JSON.stringify(payload) === JSON.stringify(stateRef.current)) return
      startTransition(() => setState(payload))
    })

    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (forceSpectator) return undefined
    if (loadStatus === 'loading') return
    const timeout = window.setTimeout(() => {
      setSaveStatus('saving')
      saveTournamentState(state, { operatorPin })
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'))
    }, 240)

    return () => window.clearTimeout(timeout)
  }, [forceSpectator, operatorPin, state, loadStatus])

  useEffect(() => {
    if (!state.lastFxEvent?.at) return
    if (lastFxAtRef.current === state.lastFxEvent.at) return
    lastFxAtRef.current = state.lastFxEvent.at
    setFx(state.lastFxEvent)
  }, [state.lastFxEvent])

  useEffect(() => {
    if (!fx) return
    const duration = fx.variant === 'reset' ? 4200 : fx.variant === 'gf' ? 3400 : 2600
    const timeout = window.setTimeout(() => setFx(null), duration)
    return () => window.clearTimeout(timeout)
  }, [fx])

  const bracket = useMemo(() => buildBracket(state), [state])
  const selectedMatchId = forceSpectator ? publicSelectedMatchId || state.selectedMatchId : state.selectedMatchId
  const selectedMatch =
    bracket.matches.find((match) => match.id === selectedMatchId) ||
    bracket.nextMatch ||
    bracket.matches.find((match) => !match.bye) ||
    bracket.matches[0]

  const updateState = (updater) => {
    if (forceSpectator) return
    setState((current) => updater(current))
  }

  const handleRecord = (matchId, winnerId, scoreA, scoreB, memo = '') => {
    updateState((current) => {
      const next = recordResult(current, matchId, winnerId, scoreA, scoreB, memo)
      if (next === current) return current
      return autoAdvance ? next : { ...next, selectedMatchId: current.selectedMatchId }
    })
  }

  const handleStartMatch = () => {
    if (!selectedMatch?.ready || selectedMatch.completed) return
    updateState((current) => ({
      ...current,
      timer: { matchId: selectedMatch.id, startedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleStopTimer = () => {
    updateState((current) => ({ ...current, timer: null, updatedAt: new Date().toISOString() }))
  }

  const handleMatchBoxSelect = (id) => {
    if (forceSpectator) {
      setPublicSelectedMatchId(id)
      const match = bracket.matches.find((item) => item.id === id)
      if (match?.completed && !match.bye) setResultPreviewMatchId(id)
      return
    }
    updateState((current) => ({ ...current, selectedMatchId: id }))
    const match = bracket.matches.find((item) => item.id === id)
    if (match?.completed && !match.bye) setResultPreviewMatchId(id)
  }

  const hasResults = Object.keys(state.results || {}).length > 0
  const spectator = forceSpectator || state.mode === 'spectator'
  const playerPage = forcePlayerPage
  const grandFinalsMode = isGrandFinalsPhase(bracket)
  const resetFinalLive = isResetFinalActive(bracket)
  const resultPreviewMatch = resultPreviewMatchId
    ? bracket.matches.find((match) => match.id === resultPreviewMatchId && match.completed && !match.bye)
    : null

  return (
    <div
      className={clsx(
        'app-frame',
        spectator && 'spectator',
        playerPage && 'player-page',
        grandFinalsMode && 'grand-finals-mode',
        resetFinalLive && 'reset-finals-mode',
        fx?.variant === 'reset' && 'reset-finals-flash',
      )}
    >
      <div className="bg-fx" aria-hidden="true">
        <div className="bg-grid" />
        <div className="bg-glow cyan" />
        <div className="bg-glow ember" />
        <div className="bg-beam" />
      </div>

      {!playerPage && (
        <TopBar
          mode={forceSpectator ? 'spectator' : state.mode}
          saveStatus={saveStatus}
          loadStatus={loadStatus}
          isPending={isPending}
          hideModeToggle={forceSpectator}
          onModeChange={(mode) => updateState((current) => ({ ...current, mode }))}
        />
      )}

      {!spectator && !isMobile && (
        <SideBar
          view={view}
          setView={setView}
          bracket={bracket}
          selectedMatch={selectedMatch}
          timer={state.timer}
          onStart={handleStartMatch}
          onStop={handleStopTimer}
        />
      )}

      {!spectator && isMobile && (
        <MobileDock
          view={view}
          setView={(id) => {
            setView(id)
            setResultSheetOpen(false)
          }}
        />
      )}

      {spectator && (
        <SpectatorNav view={view} setView={setView} playerPage={playerPage} />
      )}

      <main className={clsx('stage', playerPage && 'player-stage')}>
        {view === 'bracket' && playerPage ? (
          <PlayerBracketView
            state={state}
            bracket={bracket}
            selectedMatchId={selectedMatch?.id}
            timer={state.timer}
            fx={fx}
            onSelect={handleMatchBoxSelect}
          />
        ) : view === 'bracket' ? (
          <>
            <BracketCanvas
              state={state}
              bracket={bracket}
              selectedMatchId={selectedMatch?.id}
              timer={state.timer}
              fx={fx}
              onSelect={handleMatchBoxSelect}
              onShuffle={spectator ? null : () => updateState((current) => shufflePlayers(current))}
              shuffleLocked={hasResults}
              playerPage={spectator}
            />
            {!spectator && (
              <TimelineStrip
                bracket={bracket}
                selectedMatchId={selectedMatch?.id}
                timer={state.timer}
                onSelect={(id) => updateState((current) => ({ ...current, selectedMatchId: id }))}
              />
            )}
          </>
        ) : (
          <SubView
            view={view}
            state={state}
            bracket={bracket}
            selectedMatchId={selectedMatch?.id}
            onSelect={(id) => {
              handleMatchBoxSelect(id)
              setView('bracket')
            }}
            onNameChange={(playerId, name) => updateState((current) => updatePlayerName(current, playerId, name))}
            onAddPlayer={(name) => updateState((current) => addPlayer(current, name))}
            onRemovePlayer={(playerId) => updateState((current) => removePlayer(current, playerId))}
            onImportEntries={(entries, source) => updateState((current) => importEntries(current, entries, source))}
            onShuffle={() => updateState((current) => shufflePlayers(current))}
            shuffleLocked={hasResults}
            onReset={() => updateState(clearResults)}
            timer={state.timer}
            fx={fx}
            spectator={spectator}
            playerPage={playerPage}
          />
        )}
      </main>

      {!spectator && !isMobile && (
        <ResultPanel
          match={selectedMatch}
          timer={state.timer}
          autoAdvance={autoAdvance}
          setAutoAdvance={setAutoAdvance}
          onRecord={handleRecord}
        />
      )}

      {!spectator && isMobile && (
        <>
          <MobileMatchBar
            match={selectedMatch}
            timer={state.timer}
            onStart={handleStartMatch}
            onStop={handleStopTimer}
            onOpenSheet={() => setResultSheetOpen(true)}
          />
          <MobileResultSheet open={resultSheetOpen} onClose={() => setResultSheetOpen(false)}>
            <ResultPanel
              match={selectedMatch}
              timer={state.timer}
              autoAdvance={autoAdvance}
              setAutoAdvance={setAutoAdvance}
              onRecord={(...args) => {
                handleRecord(...args)
                setResultSheetOpen(false)
              }}
            />
          </MobileResultSheet>
        </>
      )}

      <VictoryToast fx={fx} />
      <ChampionOverlay
        champion={bracket.champion}
        grandFinalMatch={bracket.matches.find((match) => match.id === 'gf' && match.completed)}
      />
      <MatchResultPreview match={resultPreviewMatch} onClose={() => setResultPreviewMatchId(null)} />
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Top bar                                                           */
/* ---------------------------------------------------------------- */

function TopBar({ mode, onModeChange, hideModeToggle = false }) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <img
          src={logoTransparent}
          alt="連青杯 Eスポーツチャンピオンシップ UKENSON"
          width="1143"
          height="513"
          decoding="async"
          fetchPriority="high"
        />
      </div>

      {!hideModeToggle && (
        <nav className="mode-switch" aria-label="表示モード">
          <button
            type="button"
            className={clsx(mode === 'operator' && 'active')}
            onClick={() => onModeChange('operator')}
          >
            <Settings2 size={15} />
            <span>運営モード</span>
          </button>
          <button
            type="button"
            className={clsx(mode === 'spectator' && 'active')}
            onClick={() => onModeChange('spectator')}
          >
            <Eye size={15} />
            <span>観客ビュー</span>
          </button>
        </nav>
      )}
    </header>
  )
}

/* ---------------------------------------------------------------- */
/* Sidebar                                                           */
/* ---------------------------------------------------------------- */

function SideBar({ view, setView, bracket, selectedMatch, timer, onStart, onStop }) {
  const [now, setNow] = useState(Date.now())
  const running = Boolean(timer?.startedAt)

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [running])

  const done = bracket.completedCount
  const total = bracket.totalCount

  return (
    <aside className="sidebar">
      <nav className="side-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={clsx(view === item.id && 'active')}
            onClick={() => setView(item.id)}
          >
            <item.icon size={17} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="side-card current-match">
        <div className="side-card-head">
          <span>現在の試合</span>
          <em className={clsx('round-tag', selectedMatch?.side)}>{selectedMatch?.name}</em>
        </div>
        <div className="vs-row">
          <div className="vs-player p1">
            <span className="tag">P1</span>
            <strong>{selectedMatch?.playerA?.name || '未定'}</strong>
          </div>
          <span className="vs-mark">VS</span>
          <div className="vs-player p2">
            <span className="tag">P2</span>
            <strong>{selectedMatch?.playerB?.name || '未定'}</strong>
          </div>
        </div>
      </div>

      <div className="side-card progress-card">
        <div className="side-card-head">
          <span>進行状況</span>
          <em>
            {done} / {total} 試合
          </em>
        </div>
        <div className="progress-track">
          <motion.div
            className="progress-fill"
            initial={false}
            animate={{ width: `${Math.round(bracket.progress * 100)}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          />
        </div>
      </div>

      <div className={clsx('side-card timer-card', running && 'running')}>
        <div className="side-card-head">
          <span>
            <Timer size={13} /> 試合経過時間
          </span>
        </div>
        <strong className="clock">{formatClock(timer?.startedAt, running ? now : Date.now())}</strong>
        {running ? (
          <button type="button" className="start-button stop" onClick={onStop}>
            <RotateCcw size={16} />
            <span>タイマー停止</span>
          </button>
        ) : (
          <button
            type="button"
            className="start-button"
            disabled={!selectedMatch?.ready || selectedMatch?.completed}
            onClick={onStart}
          >
            <Play size={16} />
            <span>試合開始</span>
          </button>
        )}
      </div>
    </aside>
  )
}

/* ---------------------------------------------------------------- */
/* Bracket canvas                                                    */
/* ---------------------------------------------------------------- */

function BracketCanvas({ state, bracket, selectedMatchId, timer, fx, onSelect, onShuffle, shuffleLocked, playerPage = false }) {
  const { matches, champion, playerCount } = bracket
  const matchMap = useMemo(() => Object.fromEntries(matches.map((match) => [match.id, match])), [matches])
  const layout = useMemo(() => computeLayout(matches), [matches])
  const tournamentBadges = useMemo(() => buildTournamentBadges(state, bracket), [state, bracket])
  const viewportRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(() => (window.matchMedia(MOBILE_MEDIA_QUERY).matches ? 0.7 : 'fit'))
  const scaleRef = useRef(1)
  const pinchRef = useRef(null)
  const panRef = useRef(null)

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitScale = box.w
    ? Math.max(0.3, Math.min(1, (box.w - 20) / layout.width, (box.h - 20) / layout.height))
    : 1
  const scale = zoom === 'fit' ? fitScale : zoom
  const stepZoom = (delta) => setZoom(Math.min(1.4, Math.max(0.3, Math.round((scale + delta) * 20) / 20)))

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    if (!playerPage) return undefined
    const element = viewportRef.current
    if (!element) return undefined

    const distance = (touches) => {
      const [a, b] = touches
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }
    const center = (touches) => {
      const rect = element.getBoundingClientRect()
      const [a, b] = touches
      return {
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
      }
    }

    const handleTouchStart = (event) => {
      if (event.touches.length === 1) {
        const [touch] = event.touches
        panRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          scrollLeft: element.scrollLeft,
          scrollTop: element.scrollTop,
        }
        pinchRef.current = null
        return
      }
      if (event.touches.length !== 2) return
      const point = center(event.touches)
      pinchRef.current = {
        distance: distance(event.touches),
        scale: scaleRef.current,
        contentX: (element.scrollLeft + point.x) / scaleRef.current,
        contentY: (element.scrollTop + point.y) / scaleRef.current,
        point,
      }
      panRef.current = null
    }

    const handleTouchMove = (event) => {
      if (event.touches.length === 1 && panRef.current) {
        event.preventDefault()
        const [touch] = event.touches
        element.scrollLeft = panRef.current.scrollLeft - (touch.clientX - panRef.current.x)
        element.scrollTop = panRef.current.scrollTop - (touch.clientY - panRef.current.y)
        return
      }
      if (event.touches.length !== 2 || !pinchRef.current) return
      event.preventDefault()
      const point = center(event.touches)
      const nextScale = Math.min(2.2, Math.max(0.25, pinchRef.current.scale * (distance(event.touches) / pinchRef.current.distance)))
      scaleRef.current = nextScale
      setZoom(nextScale)
      window.requestAnimationFrame(() => {
        element.scrollLeft = pinchRef.current.contentX * nextScale - point.x
        element.scrollTop = pinchRef.current.contentY * nextScale - point.y
      })
    }

    const handleTouchEnd = (event) => {
      if (event.touches.length < 2) pinchRef.current = null
      if (event.touches.length === 0) panRef.current = null
    }

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [playerPage])

  return (
    <div className={clsx('bracket-wrap', playerPage && 'player-bracket-wrap')}>
      {onShuffle && (
        <div className="bracket-actions">
          <button
            type="button"
            className="accent"
            disabled={!playerCount || shuffleLocked}
            title={shuffleLocked ? '試合結果が記録されているためシャッフルできません' : undefined}
            onClick={onShuffle}
          >
            <Shuffle size={15} />
            <span>シャッフル</span>
          </button>
        </div>
      )}
      <div className="bracket-viewport" ref={viewportRef}>
        <div className="bracket-fit" style={{ width: layout.width * scale, height: layout.height * scale }}>
          <div
            className="bracket-canvas"
            style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
          >
            <svg
              className="bracket-wires"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-hidden="true"
            >
              {layout.links.map((link) => {
                const source = matchMap[link.from]
                const lit = Boolean(source?.completed)
                const sourceSlot = lit ? winnerSlot(source) : null
                const d = wirePath(layout.pos[link.from], layout.pos[link.to], link.slot, sourceSlot)
                return (
                  <g
                    key={`${link.from}-${link.to}`}
                    className={clsx('wire', link.tone, lit && 'lit', sourceSlot && `from-${sourceSlot}`)}
                  >
                    <path className="wire-base" d={d} />
                    <motion.path
                      className="wire-glow"
                      d={d}
                      initial={false}
                      animate={{ pathLength: lit ? 1 : 0, opacity: lit ? 1 : 0 }}
                      transition={{ duration: 0.85, ease: 'easeInOut' }}
                    />
                    {lit && <path className="wire-pulse" d={d} />}
                  </g>
                )
              })}
            </svg>

            <div className="section-badge winners" style={{ left: layout.badges.winners.x, top: layout.badges.winners.y }}>
              <Crown size={15} />
              <strong>勝者側</strong>
              <span>{playerCount}名</span>
            </div>
            <div className="section-badge losers" style={{ left: layout.badges.losers.x, top: layout.badges.losers.y }}>
              <Flame size={15} />
              <strong>敗者側</strong>
              <span>REVIVAL</span>
            </div>

            {layout.labels.map((label) => (
              <span
                key={`${label.side}-${label.text}-${label.x}`}
                className={clsx('round-head', label.side)}
                style={{ left: label.x, top: label.y, width: CARD_W }}
              >
                {label.text}
              </span>
            ))}

            {matches.map((match) => {
              const pos = layout.pos[match.id]
              if (!pos) return null
              return (
                <BracketMatchCard
                  key={match.id}
                  match={match}
                  x={pos[0]}
                  y={pos[1]}
                  active={selectedMatchId === match.id}
                  live={timer?.matchId === match.id && !match.completed}
                  justWon={fx?.matchId === match.id}
                  playerBadges={tournamentBadges.players}
                  matchBadges={tournamentBadges.matches[match.id] || []}
                  onSelect={() => onSelect(match.id)}
                />
              )
            })}

            <div
              className={clsx('champ-plate', champion && 'decided')}
              style={{ left: layout.champPlate.x, top: layout.champPlate.y, width: CARD_W }}
            >
              <Trophy size={30} strokeWidth={1.5} />
              <div>
                <span>CHAMPION</span>
                <strong>{champion ? champion.name : '未確定'}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!playerPage && (
        <div className="zoom-controls">
          <button type="button" onClick={() => stepZoom(-0.1)} aria-label="縮小">
            <Minus size={14} />
          </button>
          <button type="button" className={clsx(zoom === 'fit' && 'active')} onClick={() => setZoom('fit')}>
            フィット
          </button>
          <button type="button" onClick={() => stepZoom(0.1)} aria-label="拡大">
            <Plus size={14} />
          </button>
          <em>{Math.round(scale * 100)}%</em>
        </div>
      )}
    </div>
  )
}

function BracketMatchCard({ match, x, y, active, live, justWon, playerBadges, matchBadges, onSelect }) {
  const tone = match.side === 'finals' ? 'gold' : match.side === 'winners' ? 'cyan' : 'ember'
  const status = match.bye ? 'BYE' : match.completed ? '完了' : live ? 'LIVE' : match.ready ? 'READY' : '---'
  const survivorRun = matchBadges.some((badge) => badge.type === 'survivor-match')

  return (
    <motion.button
      type="button"
      className={clsx(
        'bmatch',
        tone,
        active && 'active',
        live && 'live',
        match.completed && 'done',
        (!match.ready || match.bye) && 'locked',
        justWon && 'just-won',
        survivorRun && 'survivor-run',
      )}
      style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
      onClick={match.bye ? undefined : onSelect}
      whileHover={{ scale: match.ready || match.completed ? 1.03 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
    >
      <div className="bmatch-head">
        <span className="bmatch-code">{match.label}</span>
        <span className={clsx('bmatch-status', live && 'blink')}>{status}</span>
      </div>
      {matchBadges.length > 0 && (
        <span className="match-story-badges">
          {matchBadges.map((badge) => (
            <span key={badge.type} className={clsx('match-story-badge', badge.type)} title={badge.title}>
              {badge.label}
            </span>
          ))}
        </span>
      )}
      <SlotRow match={match} who="a" badge={match.playerA ? playerBadges[match.id]?.[match.playerA.id] : null} />
      <SlotRow match={match} who="b" badge={match.playerB ? playerBadges[match.id]?.[match.playerB.id] : null} />
    </motion.button>
  )
}

function MatchResultPreview({ match, onClose }) {
  const [imageUrl, setImageUrl] = useState('')
  const [imageError, setImageError] = useState('')

  useEffect(() => {
    let live = true
    setImageUrl('')
    setImageError('')
    if (!match) return undefined

    import('./lib/shareCard')
      .then(({ renderShareCard }) => renderShareCard({ match, logoSrc: logoTransparent }))
      .then((url) => {
        if (live) setImageUrl(url)
      })
      .catch(() => {
        if (live) setImageError('SNS用結果画像を生成できませんでした')
      })

    return () => {
      live = false
    }
  }, [match])

  if (!match) return null

  return (
    <div className="match-result-overlay" role="dialog" aria-modal="true" aria-label="試合結果" onClick={onClose}>
      <div className="match-result-dialog" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="match-result-close" aria-label="閉じる" onClick={onClose}>
          <X size={18} />
        </button>

        <div className="match-result-card-preview">
          {imageUrl ? (
            <img src={imageUrl} alt={`${match.label} SNS用結果画像`} />
          ) : (
            <div className="match-result-card-loading">{imageError || 'SNS用結果画像を生成中...'}</div>
          )}
        </div>

        <ShareCardButton
          match={match}
          label="画像を保存"
          luxury={match.side === 'finals'}
          className="match-result-share"
          downloadOnly
        />
      </div>
    </div>
  )
}

function SlotRow({ match, who, badge }) {
  const player = who === 'a' ? match.playerA : match.playerB
  const score = who === 'a' ? match.scoreA : match.scoreB
  const hint = who === 'a' ? match.hintA : match.hintB
  const isWinner = Boolean(player && match.winnerId === player.id)
  const isLoser = Boolean(player && match.winnerId && match.winnerId !== player.id)
  const playerNameLength = Array.from(player?.name || '').length
  const displayName = getMatchDisplayName(player?.name)
  const compactName = playerNameLength >= MATCH_NAME_COMPACT_LENGTH

  return (
    <div className={clsx('slot-row', badge && 'has-badge', isWinner && 'winner', isLoser && 'loser')}>
      {badge && (
        <span className={clsx('slot-badge', badge.type)} title={badge.title}>
          {badge.label}
        </span>
      )}
      <span className="slot-name">
        {player ? (
          <span
            className={clsx('slot-player-name', compactName && 'compact')}
            title={player.name}
          >
            {displayName}
          </span>
        ) : (
          <em>{hint}</em>
        )}
        {isWinner && <Crown size={12} className="slot-crown" />}
      </span>
      {isWinner && <span className="slot-win-label">WIN</span>}
      <strong className="slot-score">{score === '' ? '–' : score}</strong>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Timeline strip                                                    */
/* ---------------------------------------------------------------- */

function TimelineStrip({ bracket, selectedMatchId, timer, onSelect }) {
  const nextId = bracket.nextMatch?.id

  return (
    <div className="timeline">
      <div className="timeline-head">
        <Activity size={14} />
        <span>試合タイムライン</span>
        <em>
          {bracket.completedCount} / {bracket.totalCount} 試合完了
        </em>
      </div>
      <div className="timeline-scroll">
        {bracket.playOrder
          .filter((match) => !match.bye)
          .map((match) => {
            const id = match.id
            const live = timer?.matchId === id && !match.completed
            const state = match.completed ? 'done' : live ? 'live' : id === nextId ? 'next' : 'idle'
            return (
              <button
                key={id}
                type="button"
                className={clsx('timeline-chip', state, selectedMatchId === id && 'active')}
                onClick={() => onSelect(id)}
              >
                <span className="chip-code">{match.label}</span>
                <strong>
                  {match.playerA?.name || '???'} <em>vs</em> {match.playerB?.name || '???'}
                </strong>
                <span className="chip-state">
                  {match.completed
                    ? `完了 ${match.scoreA}-${match.scoreB}`
                    : live
                      ? '進行中'
                      : id === nextId
                        ? '次の試合'
                        : '待機'}
                </span>
              </button>
            )
          })}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Result input panel                                                */
/* ---------------------------------------------------------------- */

function ResultPanel({ match, timer, autoAdvance, setAutoAdvance, onRecord }) {
  const [scoreA, setScoreA] = useState(0)
  const [scoreB, setScoreB] = useState(0)
  const [memo, setMemo] = useState('')

  useEffect(() => {
    setScoreA(match?.scoreA === '' || match?.scoreA === undefined ? 0 : match.scoreA)
    setScoreB(match?.scoreB === '' || match?.scoreB === undefined ? 0 : match.scoreB)
    setMemo('')
  }, [match?.id, match?.scoreA, match?.scoreB])

  const disabled = !match?.ready
  const overlayUrl = `${window.location.origin}${window.location.pathname}#/overlay`

  const record = (winnerId, sA = scoreA, sB = scoreB) => {
    if (!match?.ready || !winnerId) return
    onRecord(match.id, winnerId, sA, sB, memo)
  }

  return (
    <aside className="result-panel">
      <div className="panel-block">
        <div className="panel-title">
          <Zap size={15} />
          <h2>結果入力パネル</h2>
        </div>

        <div className="panel-sub">
          <span>現在の対戦</span>
          <em className={clsx('round-tag', match?.side)}>{match?.name}</em>
        </div>

        <div className="face-off">
          <div className="face p1">
            <span>P1</span>
            <strong>{match?.playerA?.name || '未定'}</strong>
          </div>
          <span className="face-vs">VS</span>
          <div className="face p2">
            <span>P2</span>
            <strong>{match?.playerB?.name || '未定'}</strong>
          </div>
        </div>

        <div className="score-grid">
          <ScoreStepper
            label={match?.playerA?.name || 'P1'}
            value={scoreA}
            onChange={setScoreA}
            disabled={disabled}
          />
          <ScoreStepper
            label={match?.playerB?.name || 'P2'}
            value={scoreB}
            onChange={setScoreB}
            disabled={disabled}
          />
        </div>

        <div className="record-buttons">
          <button
            type="button"
            className="record p1"
            disabled={disabled || !match?.playerA}
            onClick={() => record(match.playerA.id)}
          >
            <Crown size={15} />
            <span>{match?.playerA?.name || 'P1'} の勝利を記録</span>
          </button>
          <button
            type="button"
            className="record p2"
            disabled={disabled || !match?.playerB}
            onClick={() => record(match.playerB.id)}
          >
            <Crown size={15} />
            <span>{match?.playerB?.name || 'P2'} の勝利を記録</span>
          </button>
        </div>

        {match?.completed && (
          <p className="rewrite-warning">
            <RotateCcw size={12} />
            記録済みの試合です。再記録すると以降の結果はリセットされます。
          </p>
        )}

        <label className="memo-field">
          <span>試合メモ（任意）</span>
          <textarea
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="試合のメモを入力…"
            rows={2}
          />
        </label>
      </div>

      <div className="panel-block">
        <div className="panel-title compact">
          <Swords size={14} />
          <h2>ショートカット</h2>
        </div>
        <div className="shortcut-grid">
          <button
            type="button"
            disabled={disabled || !match?.playerA}
            onClick={() => record(match.playerA.id, 2, 0)}
          >
            <strong>P1 勝利</strong>
            <span>2 - 0</span>
          </button>
          <button
            type="button"
            disabled={disabled || !match?.playerB}
            onClick={() => record(match.playerB.id, 0, 2)}
          >
            <strong>P2 勝利</strong>
            <span>0 - 2</span>
          </button>
          <button
            type="button"
            disabled={disabled || !match?.playerA}
            onClick={() => record(match.playerA.id, 2, 1)}
          >
            <strong>P1 勝利</strong>
            <span>2 - 1</span>
          </button>
          <button
            type="button"
            disabled={disabled || !match?.playerB}
            onClick={() => record(match.playerB.id, 1, 2)}
          >
            <strong>P2 勝利</strong>
            <span>1 - 2</span>
          </button>
        </div>
      </div>

      <div className="panel-block">
        <div className="panel-title compact">
          <RadioTower size={14} />
          <h2>自動進行・配信</h2>
        </div>
        <label className="toggle-row">
          <span>結果記録後に次の試合をアクティブにする</span>
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(event) => setAutoAdvance(event.target.checked)}
          />
          <i className="toggle-ui" />
        </label>
        <button
          type="button"
          className="overlay-open"
          onClick={() => window.open(overlayUrl, 'ukenson-overlay', 'width=1280,height=720')}
        >
          <span>配信用オーバーレイを開く</span>
          <ExternalLink size={15} />
        </button>
        {timer?.startedAt && (
          <p className="overlay-hint">
            <Timer size={12} /> タイマー進行中 — オーバーレイにも表示されます
          </p>
        )}
      </div>
    </aside>
  )
}

function ScoreStepper({ label, value, onChange, disabled }) {
  const number = Number(value) || 0
  return (
    <div className={clsx('stepper', disabled && 'disabled')}>
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" disabled={disabled || number <= 0} onClick={() => onChange(number - 1)}>
          <Minus size={14} />
        </button>
        <strong>{number}</strong>
        <button type="button" disabled={disabled || number >= 9} onClick={() => onChange(number + 1)}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Player lookup & highlights                                        */
/* ---------------------------------------------------------------- */

function PlayerBracketView({ state, bracket, selectedMatchId, timer, fx, onSelect }) {
  return (
    <section className="player-bracket-page" aria-label="トーナメント表">
      <img
        src={logoTransparent}
        alt="連青杯"
        className="player-bracket-logo"
        width="1143"
        height="513"
        decoding="async"
        fetchPriority="high"
      />
      <BracketCanvas
        state={state}
        bracket={bracket}
        selectedMatchId={selectedMatchId}
        timer={timer}
        fx={fx}
        onSelect={onSelect}
        playerPage
      />
    </section>
  )
}

function PlayerLookupView({ state, bracket, playerPage = false }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const activePlayers = state.players.filter((player) => player.active !== false && player.name)
  const matches = findPlayersByQuery(state.players, query)
  const selectedPlayer = selectedId
    ? state.players.find((player) => player.id === selectedId)
    : query.trim()
      ? matches[0] || null
      : null
  const profile = selectedPlayer ? buildPlayerProfile(selectedPlayer, state, bracket) : null
  const queueLabel =
    !profile || profile.matchesUntil === null
      ? '—'
      : profile.matchesUntil === 0
        ? 'まもなく'
        : String(profile.matchesUntil)
  const queueUnit =
    !profile || profile.matchesUntil === null
      ? 'WAIT'
      : profile.matchesUntil === 0
        ? 'NOW'
        : 'MATCHES'

  const content = (
    <>
      <header className="player-page-header">
        <img
          src={logoTransparent}
          alt="連青杯"
          className="player-page-logo"
          width="1143"
          height="513"
          decoding="async"
          fetchPriority="high"
        />
        <div>
          <p className="player-page-eyebrow">UKENSON TOURNAMENT</p>
          <h1>YOUR MATCH</h1>
          <p className="player-page-lead">自分の名前を選ぶだけで、呼び出し順・対戦相手・直近結果を確認できます。</p>
        </div>
      </header>

      <form
        className="player-page-search"
        onSubmit={(event) => {
          event.preventDefault()
          if (matches[0]) setSelectedId(matches[0].id)
        }}
      >
        <div className="player-page-search-row">
          <Search size={18} className="player-page-search-icon" aria-hidden="true" />
          <input
            className="player-page-search-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedId(null)
            }}
            placeholder="名前で検索"
            enterKeyHint="search"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="player-page-clear-button"
              aria-label="検索をクリア"
              onClick={() => {
                setQuery('')
                setSelectedId(null)
              }}
            >
              <X size={16} />
            </button>
          )}
          <button type="submit" className="player-page-search-button">
            表示
          </button>
        </div>
      </form>

      {!query.trim() && activePlayers.length === 0 && (
        <p className="player-page-empty">まだ選手が登録されていません。運営側でエントリーを登録すると、ここから検索できます。</p>
      )}
      {!query.trim() && activePlayers.length > 0 && !profile && (
        <p className="player-page-empty">名前を入力すると、呼び出し順・対戦相手・直近結果を確認できます。</p>
      )}
      {query.trim() && matches.length === 0 && (
        <p className="player-page-empty">該当する選手が見つかりませんでした。表記ゆれがある場合は、名前の一部だけで検索してください。</p>
      )}

      {profile && (
        <div className="player-page-body">
          <div className="player-page-hero">
            <div className="player-page-hero-main">
              <span className="player-page-seed">SEED {profile.player.seed}</span>
              <h2>{profile.player.name}</h2>
            </div>
            <span className={clsx('player-page-status', profile.status.tone)}>{profile.status.label}</span>
          </div>

          <section className="player-page-queue" aria-label="あなたの番まで">
            <span>あなたの番まで</span>
            <strong>{queueLabel}</strong>
            <small>{queueUnit}</small>
            <p>{profile.waitEstimate || '次の試合枠が未確定です'}</p>
            {profile.matchesUntil === 0 && <em className="player-page-queue-live">控え室へ向かってください</em>}
          </section>

          <section className="player-page-stack">
            <article className="player-page-card">
              <span>現在の位置</span>
              <strong>{profile.position}</strong>
            </article>
            <article className="player-page-card accent">
              <span>次の対戦相手</span>
              <strong>{profile.nextOpponent?.name || '未定'}</strong>
            </article>
            <article className="player-page-card">
              <span>直近の試合</span>
              <strong>
                {profile.lastResult
                  ? `${profile.lastResult.won ? 'WIN' : 'LOSS'} ${profile.lastResult.score}`
                  : '未プレイ'}
              </strong>
              {profile.lastResult && (
                <em>
                  vs {profile.lastResult.opponent} · {profile.lastResult.name}
                </em>
              )}
            </article>
          </section>

          <section className="player-page-stats" aria-label="スタッツ">
            <div>
              <span>連勝</span>
              <strong>{profile.stats.winStreak}</strong>
            </div>
            <div>
              <span>勝敗</span>
              <strong>
                {profile.stats.wins}-{profile.stats.losses}
              </strong>
            </div>
            <div>
              <span>UPSET</span>
              <strong>{profile.stats.upsets}</strong>
            </div>
            <div>
              <span>ゲーム</span>
              <strong>{profile.stats.totalGames}</strong>
            </div>
          </section>

          {profile.lastMatch && (
            <ShareCardButton
              match={profile.lastMatch}
              label="SNS用 結果画像"
              luxury={profile.lastMatch.side === 'finals'}
              className="player-page-share"
            />
          )}
        </div>
      )}
    </>
  )

  if (playerPage) {
    return <section className="player-page-shell">{content}</section>
  }

  return (
    <ViewShell
      icon={Search}
      title="YOUR MATCH"
      sub="名前で検索して、現在位置・次の対戦相手・あと何試合で呼ばれるかを確認できます"
    >
      <div className="lookup-desktop-fallback">{content}</div>
    </ViewShell>
  )
}

/**
 * 枠幅に収まるようフォントサイズを自動縮小する選手名。
 * CSS側のフォント指定(cqw)を基準に、はみ出す場合のみminRatioまで縮小する。
 * それでも収まらない場合、wrap指定の枠(縦に余裕がある枠)は2行に折り返し、
 * それ以外は省略記号で切り詰める。
 */
function AutoFitName({ text, className, minRatio = 0.72, wrap = false, ...rest }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    let cancelled = false
    const fit = () => {
      if (cancelled) return
      el.style.fontSize = ''
      el.style.whiteSpace = ''
      el.style.wordBreak = ''
      el.style.display = ''
      el.style.webkitBoxOrient = ''
      el.style.webkitLineClamp = ''
      if (!text) return
      const available = el.clientWidth
      const needed = el.scrollWidth
      if (!available || needed <= available) return
      const base = parseFloat(window.getComputedStyle(el).fontSize)
      const ratio = available / needed
      el.style.fontSize = `${base * Math.max(ratio, minRatio)}px`
      if (wrap && ratio < minRatio) {
        el.style.whiteSpace = 'normal'
        el.style.wordBreak = 'break-word'
        el.style.display = '-webkit-box'
        el.style.webkitBoxOrient = 'vertical'
        el.style.webkitLineClamp = '2'
      }
    }

    fit()
    document.fonts?.ready.then(fit).catch(() => {})
    const observer = new ResizeObserver(fit)
    if (el.parentElement) observer.observe(el.parentElement)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [text, minRatio, wrap])

  return (
    <strong ref={ref} className={className} {...rest}>
      {text}
    </strong>
  )
}

const SPOTLIGHT_SLOTS = [
  { rank: 1, className: 'first' },
  { rank: 2, className: 'second' },
  { rank: 3, className: 'small small-3' },
  { rank: 4, className: 'small small-4' },
  { rank: 5, className: 'small small-5' },
  { rank: 6, className: 'small small-6' },
  { rank: 7, className: 'small small-7' },
  { rank: 8, className: 'small small-8' },
]

function SpotlightPlayerSlot({ row, slot }) {
  const empty = !row
  const rankLabel = slot.rank === 1 ? '1位' : `${slot.rank}位`

  return (
    <motion.div
      key={`${slot.rank}-${row?.player.id || 'empty'}`}
      layout
      className={clsx('spotlight-player-slot', slot.className, empty && 'empty')}
      initial={{ opacity: 0, scale: slot.rank === 1 ? 0.86 : 0.92, y: slot.rank === 1 ? 28 : 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 230, damping: 22 }}
    >
      <span className="spotlight-rank">{rankLabel}</span>
      <AutoFitName
        key={`${slot.rank}-${row?.player.id || 'empty'}-name`}
        className="spotlight-name"
        title={row?.player.name || undefined}
        text={row?.player.name || '—'}
        minRatio={slot.rank <= 2 ? 0.6 : 0.72}
        wrap={slot.rank === 1}
      />
    </motion.div>
  )
}

function FeaturedPlayersBoard({ players }) {
  return (
    <div className="featured-players-board" aria-label="注目選手ランキング">
      <img
        src={featuredPlayersTemplate}
        alt=""
        aria-hidden="true"
        className="featured-players-template"
        width="540"
        height="960"
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
      <div className="featured-players-overlay">
        {SPOTLIGHT_SLOTS.map((slot) => (
          <SpotlightPlayerSlot key={slot.rank} slot={slot} row={players[slot.rank - 1]} />
        ))}
      </div>
    </div>
  )
}

function HighlightsView({ state, bracket, playerPage = false }) {
  const featuredPlayers = useMemo(() => buildFeaturedPlayers(state, bracket), [state, bracket])

  const body = featuredPlayers.length === 0 ? (
    <p className="empty-note">参加選手が登録されると注目選手が表示されます。</p>
  ) : (
    <FeaturedPlayersBoard players={featuredPlayers} />
  )

  if (playerPage) {
    return (
      <section className="player-page-shell player-subpage featured-players-page">
        {body}
      </section>
    )
  }

  return <section className="featured-players-page">{body}</section>
}

/* ---------------------------------------------------------------- */
/* Live ranking                                                      */
/* ---------------------------------------------------------------- */

const RANKING_BOARD_SLOTS = [
  { rank: 1, className: 'rb-1' },
  { rank: 2, className: 'rb-2' },
  { rank: 3, className: 'rb-3' },
  { rank: 4, className: 'rb-pill rb-4' },
  { rank: 5, className: 'rb-pill rb-5' },
  { rank: 6, className: 'rb-pill rb-6' },
  { rank: 7, className: 'rb-pill rb-7' },
  { rank: 8, className: 'rb-pill rb-8' },
  { rank: 9, className: 'rb-pill rb-9' },
  { rank: 10, className: 'rb-pill rb-10' },
  { rank: 11, className: 'rb-pill rb-11' },
]

function RankingBoard({ ranking }) {
  return (
    <div className="ranking-board" aria-label="ランキング上位">
      <img
        src={rankingTemplate}
        alt=""
        aria-hidden="true"
        className="ranking-board-template"
        width="1080"
        height="1920"
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
      <div className="ranking-board-overlay">
        {RANKING_BOARD_SLOTS.map((slot) => {
          const row = ranking[slot.rank - 1]
          return (
            <div key={slot.rank} className={clsx('rb-slot', slot.className, !row && 'empty')}>
              <AutoFitName
                key={`${slot.rank}-${row?.player.id || 'empty'}`}
                className="spotlight-name"
                title={row?.player.name || undefined}
                text={row?.player.name || '—'}
                minRatio={slot.rank <= 3 ? 0.6 : 0.72}
                wrap={slot.rank <= 3}
              />
              {row && slot.rank <= 3 && (
                <span className="rb-record">
                  {row.stats.wins}勝{row.stats.losses}敗
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RankingRow({ row, champion }) {
  const top = row.rank === 1
  const eliminated = row.status.type === 'eliminated'

  return (
    <motion.div
      layout
      key={row.player.id}
      className={clsx(
        'rank-row',
        top && 'first',
        row.rank === 2 && 'second',
        row.rank === 3 && 'third',
        eliminated && 'out',
      )}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      {top && <span className="rank-shine" aria-hidden="true" />}
      <span className="rank-no">
        {top ? <Crown size={26} strokeWidth={2.2} /> : row.rank}
      </span>
      <div className="rank-main">
        {top && <span className="rank-caption">{champion ? 'CHAMPION' : '暫定首位'}</span>}
        <strong className="rank-name">{row.player.name}</strong>
      </div>
      <div className="rank-record">
        <strong>
          {row.stats.wins}勝 {row.stats.losses}敗
        </strong>
        <span>
          {row.stats.winStreak >= 2 && `${row.stats.winStreak}連勝中 `}
          {row.stats.upsets > 0 && `UP${row.stats.upsets}`}
          {row.stats.winStreak < 2 && row.stats.upsets === 0 && `${row.stats.matchesPlayed}試合`}
        </span>
      </div>
    </motion.div>
  )
}

function RankingView({ state, bracket, playerPage = false }) {
  const ranking = useMemo(() => buildLiveRanking(state, bracket), [state, bracket])
  const champion = Boolean(bracket.champion)

  const body = ranking.length === 0 ? (
    <p className="empty-note">参加選手が登録されるとランキングが表示されます。</p>
  ) : (
    <>
      <RankingBoard ranking={ranking} />
      {ranking.length > 11 && (
        <div className="rank-list rank-list-overflow">
          {ranking.slice(11).map((row) => (
            <RankingRow key={row.player.id} row={row} champion={champion} />
          ))}
        </div>
      )}
    </>
  )

  if (playerPage) {
    return <section className="player-page-shell player-subpage ranking-page">{body}</section>
  }

  return <section className="view-shell ranking-page">{body}</section>
}

/* ---------------------------------------------------------------- */
/* Sub views                                                         */
/* ---------------------------------------------------------------- */

function SpectatorNav({ view, setView, playerPage = false }) {
  return (
    <nav className={clsx('spectator-nav', playerPage && 'player-bottom-nav')}>
      {PUBLIC_NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={clsx(view === item.id && 'active')}
          onClick={() => setView(item.id)}
        >
          <item.icon size={playerPage ? 20 : 16} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

/* ---------------------------------------------------------------- */
/* Mobile control deck (operator)                                    */
/* ---------------------------------------------------------------- */

function MobileDock({ view, setView }) {
  return (
    <nav className="mobile-dock" aria-label="メニュー">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={clsx(view === item.id && 'active')}
          onClick={() => setView(item.id)}
        >
          <item.icon size={19} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function MobileMatchBar({ match, timer, onStart, onStop, onOpenSheet }) {
  const [now, setNow] = useState(Date.now())
  const running = Boolean(timer?.startedAt)

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [running])

  return (
    <div className="mobile-matchbar">
      <button type="button" className="matchbar-main" onClick={onOpenSheet}>
        <span className="matchbar-meta">
          <em className={clsx('round-tag', match?.side)}>{match?.name || '試合未選択'}</em>
          {running && <strong className="matchbar-clock">{formatClock(timer?.startedAt, now)}</strong>}
        </span>
        <strong className="matchbar-names">
          {match?.playerA?.name || '未定'} <em>vs</em> {match?.playerB?.name || '未定'}
        </strong>
      </button>
      <button
        type="button"
        className={clsx('matchbar-timer', running && 'running')}
        aria-label={running ? 'タイマー停止' : '試合開始'}
        disabled={!running && (!match?.ready || match?.completed)}
        onClick={running ? onStop : onStart}
      >
        {running ? <RotateCcw size={19} /> : <Play size={19} />}
      </button>
      <button type="button" className="matchbar-record" onClick={onOpenSheet}>
        <Zap size={16} />
        <span>結果入力</span>
      </button>
    </div>
  )
}

function MobileResultSheet({ open, onClose, children }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="result-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="結果入力パネル"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
          >
            <button type="button" className="sheet-grip" aria-label="閉じる" onClick={onClose}>
              <i />
            </button>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function SubView({
  view,
  state,
  bracket,
  selectedMatchId,
  onSelect,
  onNameChange,
  onAddPlayer,
  onRemovePlayer,
  onImportEntries,
  onShuffle,
  shuffleLocked,
  onReset,
  timer,
  fx,
  spectator = false,
  playerPage = false,
}) {
  if (view === 'bracket' && playerPage)
    return <PlayerBracketView state={state} bracket={bracket} selectedMatchId={selectedMatchId} timer={timer} fx={fx} onSelect={onSelect} />
  if (view === 'lookup') return <PlayerLookupView state={state} bracket={bracket} playerPage={playerPage} />
  if (view === 'highlights') return <HighlightsView state={state} bracket={bracket} playerPage={playerPage} />
  if (view === 'ranking') return <RankingView state={state} bracket={bracket} playerPage={playerPage} />
  if (view === 'matches') return <MatchesView bracket={bracket} selectedMatchId={selectedMatchId} onSelect={onSelect} />
  if (view === 'players' && !spectator)
    return <PlayersView state={state} onNameChange={onNameChange} onAddPlayer={onAddPlayer} onRemovePlayer={onRemovePlayer} />
  if (view === 'cards' && !spectator)
    return (
      <CardsView state={state} onImportEntries={onImportEntries} onShuffle={onShuffle} shuffleLocked={shuffleLocked} />
    )
  if (view === 'history')
    return <HistoryView state={state} bracket={bracket} onSelect={spectator ? null : onSelect} playerPage={playerPage} />
  if (view === 'broadcast' && !spectator) return <BroadcastView />
  if (view === 'settings' && !spectator) return <SettingsView onReset={onReset} />
  return null
}

function ViewShell({ icon: Icon, title, sub, children }) {
  return (
    <section className="view-shell">
      <header className="view-head">
        <Icon size={20} />
        <div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function MatchesView({ bracket, selectedMatchId, onSelect }) {
  const groups = [
    { key: 'winners', title: '勝者側', tone: 'cyan' },
    { key: 'losers', title: '敗者側', tone: 'ember' },
    { key: 'finals', title: 'グランドファイナル', tone: 'gold' },
  ]
  return (
    <ViewShell icon={ListOrdered} title="試合一覧" sub="クリックで結果入力パネルにセットします">
      {groups.map((group) => (
        <div key={group.key} className="match-group">
          <h3 className={group.tone}>{group.title}</h3>
          <div className="match-table">
            {bracket.matches
              .filter((match) => match.side === group.key && !match.bye)
              .map((match) => (
                <button
                  key={match.id}
                  type="button"
                  className={clsx('match-line', group.tone, selectedMatchId === match.id && 'active')}
                  onClick={() => onSelect(match.id)}
                >
                  <span className="line-code">{match.label}</span>
                  <strong>
                    {match.playerA?.name || match.hintA} <em>vs</em> {match.playerB?.name || match.hintB}
                  </strong>
                  <span className={clsx('line-state', match.completed && 'done')}>
                    {match.completed ? `${match.scoreA} - ${match.scoreB}` : match.ready ? 'READY' : '待機'}
                  </span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </ViewShell>
  )
}

function PlayersView({ state, onNameChange, onAddPlayer, onRemovePlayer }) {
  const [newName, setNewName] = useState('')
  const activeCount = state.players.filter((player) => player.active !== false && player.name).length
  const isFull = activeCount >= MAX_PLAYERS

  const handleAdd = (event) => {
    event.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed || isFull) return
    onAddPlayer(trimmed)
    setNewName('')
  }

  return (
    <ViewShell
      icon={Users}
      title="選手一覧"
      sub={`最大${MAX_PLAYERS}名まで登録できます。手動で追加・削除が可能です（変更時は試合結果がリセットされます）`}
    >
      <form className="player-add-form" onSubmit={handleAdd}>
        <input
          className="player-add-input"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="プレイヤーネームを入力"
          disabled={isFull}
        />
        <button type="submit" className="action-button accent" disabled={isFull || !newName.trim()}>
          <Plus size={16} />
          <span>選手を追加</span>
        </button>
      </form>

      <div className="player-add-summary">
        <strong>{activeCount}名登録</strong>
        <span>{isFull ? '上限に達しました' : `あと${MAX_PLAYERS - activeCount}名追加可能`}</span>
      </div>

      {state.players.length === 0 ? (
        <p className="empty-note">まだ選手が登録されていません。上のフォームから追加するか、対戦カード管理でCSVを取り込んでください。</p>
      ) : (
        <div className="player-grid">
          {state.players.map((player) => (
            <div key={player.id} className={clsx('player-cell', player.active === false && 'inactive')}>
              <div className="player-cell-head">
                <span>SEED {player.seed}</span>
                <button
                  type="button"
                  className="player-remove-button"
                  title={`${player.name || '選手'}を削除`}
                  aria-label={`${player.name || '選手'}を削除`}
                  onClick={() => onRemovePlayer(player.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <input value={player.name} onChange={(event) => onNameChange(player.id, event.target.value)} />
            </div>
          ))}
        </div>
      )}
    </ViewShell>
  )
}

function CardsView({ state, onImportEntries, onShuffle, shuffleLocked }) {
  const [rawText, setRawText] = useState('')
  const [summary, setSummary] = useState(null)

  const applyText = (text, source) => {
    const parsed = parseEntryText(text)
    setRawText(text)
    setSummary({
      source,
      count: parsed.entries.length,
      column: parsed.headers[parsed.nameIndex] || '1列目',
    })
    if (parsed.entries.length) onImportEntries(parsed.entries, source)
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    applyText(text, file.name)
    event.target.value = ''
  }

  return (
    <ViewShell
      icon={Swords}
      title="対戦カード管理"
      sub={`Googleフォームの申込データから対戦カードを生成（最大${MAX_PLAYERS}名・超過分は待機リスト）`}
    >
      <div className="entry-actions">
        <label className="action-button">
          <Upload size={16} />
          <span>CSVを選択</span>
          <input accept=".csv,.tsv,text/csv,text/tab-separated-values" type="file" onChange={handleFile} />
        </label>
        <button type="button" className="action-button" disabled={!rawText.trim()} onClick={() => applyText(rawText, '貼り付けデータ')}>
          <Clipboard size={16} />
          <span>貼り付け取込</span>
        </button>
        <button
          type="button"
          className="action-button accent"
          disabled={shuffleLocked}
          title={shuffleLocked ? '試合結果が記録されているためシャッフルできません' : undefined}
          onClick={onShuffle}
        >
          <Shuffle size={16} />
          <span>対戦をシャッフル</span>
        </button>
      </div>
      {shuffleLocked && (
        <p className="shuffle-lock-note">
          <Flame size={12} />
          試合結果が記録されているため、対戦カードのシャッフルはできません。やり直す場合は「結果をリセット」してください。
        </p>
      )}

      <textarea
        className="entry-textarea"
        value={rawText}
        onChange={(event) => setRawText(event.target.value)}
        placeholder="Googleフォーム回答シートのCSV、またはスプレッドシートからコピーした表を貼り付け"
      />

      <div className="entry-summary">
        <strong>
          {state.entriesMeta?.importedCount || state.players.filter((player) => player.active !== false).length}
          名エントリー
        </strong>
        <span>{state.entriesMeta?.waitlistCount ? `待機 ${state.entriesMeta.waitlistCount}名` : '待機なし'}</span>
        <span>{summary ? `${summary.column}列から${summary.count}名検出` : state.entriesMeta?.source || 'sample'}</span>
      </div>
    </ViewShell>
  )
}

function HistoryView({ state, bracket, onSelect, playerPage = false }) {
  const entries = bracket.matches
    .filter((match) => match.completed)
    .map((match) => ({ match, saved: state.results[match.id] }))
    .sort((a, b) => new Date(b.saved?.recordedAt || 0) - new Date(a.saved?.recordedAt || 0))

  const list = (
    <>
      {entries.length === 0 && <p className="empty-note">まだ記録された結果はありません。</p>}
      <div className={clsx('history-list', playerPage && 'player-history-list')}>
        {entries.map(({ match, saved }) => {
          const winner = match.winnerId === match.playerA?.id ? match.playerA : match.playerB
          const Wrapper = onSelect ? 'button' : 'div'
          return (
            <Wrapper
              key={match.id}
              type={onSelect ? 'button' : undefined}
              className={clsx('history-line', !onSelect && 'static', playerPage && 'player-history-card')}
              onClick={onSelect ? () => onSelect(match.id) : undefined}
            >
              <div className="player-history-head">
                <span className="line-code">{match.label}</span>
                <span className="history-time">
                  {saved?.recordedAt
                    ? new Date(saved.recordedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
                    : ''}
                </span>
              </div>
              <strong className="player-history-score">
                {match.playerA?.name} {match.scoreA} - {match.scoreB} {match.playerB?.name}
              </strong>
              <span className="history-winner">
                <Crown size={12} /> {winner?.name}
              </span>
              {saved?.memo && <span className="history-memo">{saved.memo}</span>}
              <ShareCardButton
                match={match}
                label="SNS用 結果画像"
                luxury={match.side === 'finals'}
                className="history-share"
              />
            </Wrapper>
          )
        })}
      </div>
    </>
  )

  if (playerPage) {
    return (
      <section className="player-page-shell player-subpage">
        <header className="player-page-header compact">
          <div>
            <p className="player-page-eyebrow">UKENSON TOURNAMENT</p>
            <h1>結果履歴</h1>
          </div>
        </header>
        {list}
      </section>
    )
  }

  return (
    <ViewShell icon={History} title="結果履歴" sub="記録した結果の一覧。SNSシェアカードもここから作成できます">
      {list}
    </ViewShell>
  )
}

function BroadcastView() {
  const overlayUrl = `${window.location.origin}${window.location.pathname}#/overlay`
  const spectatorUrl = `${window.location.origin}${window.location.pathname}?view=spectator`
  const playerUrl = `${window.location.origin}${window.location.pathname}?view=player`
  const [copied, setCopied] = useState('')

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <ViewShell icon={MonitorPlay} title="配信・画面出力" sub="OBSブラウザソース用のオーバーレイを出力します">
      <div className="broadcast-grid">
        <div className="broadcast-card">
          <h3>配信用オーバーレイ</h3>
          <p>
            現在の対戦・スコア・経過時間・次の試合をリアルタイム表示。背景は透過なので、OBSのブラウザソースに
            そのまま重ねられます（結果を記録すると自動更新）。
          </p>
          <div className="broadcast-actions">
            <button
              type="button"
              className="action-button accent"
              onClick={() => window.open(overlayUrl, 'ukenson-overlay', 'width=1280,height=720')}
            >
              <ExternalLink size={16} />
              <span>オーバーレイを開く</span>
            </button>
            <button type="button" className="action-button" onClick={() => copy(overlayUrl, 'overlay')}>
              <Clipboard size={16} />
              <span>{copied === 'overlay' ? 'コピーしました' : 'URLをコピー'}</span>
            </button>
          </div>
          <code className="overlay-url">{overlayUrl}</code>
        </div>
        <div className="broadcast-card">
          <h3>選手向けモバイルページ</h3>
          <p>YOUR MATCH検索に特化した縦型レイアウト。控室や会場でスマホから見る用途向けです。</p>
          <div className="broadcast-actions">
            <button
              type="button"
              className="action-button accent"
              onClick={() => window.open(playerUrl, 'ukenson-player', 'width=430,height=900')}
            >
              <ExternalLink size={16} />
              <span>選手ページを開く</span>
            </button>
            <button type="button" className="action-button" onClick={() => copy(playerUrl, 'player')}>
              <Clipboard size={16} />
              <span>{copied === 'player' ? 'コピーしました' : 'URLをコピー'}</span>
            </button>
          </div>
          <code className="overlay-url">{playerUrl}</code>
        </div>
        <div className="broadcast-card">
          <h3>観客・選手向けページ</h3>
          <p>YOUR MATCH検索、ハイライト、結果履歴、SNSシェアカードをログインなしで利用できます。</p>
          <div className="broadcast-actions">
            <button
              type="button"
              className="action-button accent"
              onClick={() => window.open(spectatorUrl, 'ukenson-spectator', 'width=1280,height=900')}
            >
              <ExternalLink size={16} />
              <span>観客ページを開く</span>
            </button>
            <button type="button" className="action-button" onClick={() => copy(spectatorUrl, 'spectator')}>
              <Clipboard size={16} />
              <span>{copied === 'spectator' ? 'コピーしました' : 'URLをコピー'}</span>
            </button>
          </div>
          <code className="overlay-url">{spectatorUrl}</code>
        </div>
        <div className="broadcast-card">
          <h3>OBS設定メモ</h3>
          <ul>
            <li>ソース → ブラウザ → URLに上記を貼り付け（1920×1080推奨）</li>
            <li>「カスタムCSSなし」でも背景は透過されます</li>
            <li>観客用の全画面ブラケットは「観客ビュー」をウィンドウキャプチャ</li>
            <li>{hasSupabaseConfig ? 'Supabase接続中：別PCでも同期されます' : 'ローカルモード：同じPCの別ウィンドウ間で同期されます'}</li>
          </ul>
        </div>
      </div>
    </ViewShell>
  )
}

function SettingsView({ onReset }) {
  return (
    <ViewShell icon={Settings2} title="設定" sub="大会ルールと管理操作">
      <div className="settings-grid">
        <div className="broadcast-card">
          <h3>大会レギュレーション</h3>
          <ul>
            <li>形式：Wエリミネーション（最大{MAX_PLAYERS}名）</li>
            <li>7分・3ストック・アイテムなし</li>
            <li>チャージ切りふだなし</li>
            <li>グランドファイナルは勝者側1回負け直しあり</li>
          </ul>
        </div>
        <div className="broadcast-card danger">
          <h3>管理操作</h3>
          <p>全試合の結果を消去してブラケットを初期状態に戻します。選手登録は保持されます。</p>
          <button type="button" className="action-button danger" onClick={onReset}>
            <RotateCcw size={16} />
            <span>結果をすべてリセット</span>
          </button>
        </div>
      </div>
    </ViewShell>
  )
}

/* ---------------------------------------------------------------- */
/* FX overlays                                                       */
/* ---------------------------------------------------------------- */

function VictoryToast({ fx }) {
  const label =
    fx?.variant === 'reset' ? 'BRACKET RESET' : fx?.variant === 'gf' ? 'GRAND FINAL' : 'WINNER'

  return (
    <AnimatePresence>
      {fx && (
        <motion.div
          key={fx.at}
          className={clsx('victory-toast', fx.side, fx.variant === 'reset' && 'reset-finals', fx.variant === 'gf' && 'grand-finals')}
          initial={{ opacity: 0, x: 80, skewX: -8 }}
          animate={{ opacity: 1, x: 0, skewX: -8 }}
          exit={{ opacity: 0, x: -60, skewX: -8 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        >
          <span className="toast-label">{label}</span>
          <strong>{fx.name}</strong>
          <span className="toast-sweep" aria-hidden="true" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ChampionOverlay({ champion, grandFinalMatch }) {
  const [dismissedId, setDismissedId] = useState(null)
  const show = champion && dismissedId !== champion.id

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="champion-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setDismissedId(champion.id)}
        >
          <div className="champion-rays" aria-hidden="true" />
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} className="confetti" style={{ '--i': index }} aria-hidden="true" />
          ))}
          <motion.div
            className="champion-card"
            initial={{ scale: 0.7, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 18, delay: 0.15 }}
            onClick={(event) => event.stopPropagation()}
          >
            <Trophy size={72} strokeWidth={1.4} />
            <span>GRAND CHAMPION</span>
            <h2>{champion.name}</h2>
            <p>連青杯 Eスポーツチャンピオンシップ 優勝</p>
            {grandFinalMatch && (
              <ShareCardButton match={grandFinalMatch} label="優勝カードをSNSシェア" luxury />
            )}
            <em>背景クリックで閉じる</em>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ---------------------------------------------------------------- */
/* Broadcast overlay (OBS browser source)                            */
/* ---------------------------------------------------------------- */

function BroadcastOverlay() {
  const [state, setState] = useState(createInitialState)
  const [now, setNow] = useState(Date.now())
  const [fx, setFx] = useState(null)
  const lastFxAtRef = useRef(null)

  useEffect(() => {
    document.documentElement.classList.add('overlay-root')
    loadTournamentState().then(setState).catch(() => {})
    const unsubscribe = subscribeTournamentState(setState)
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      document.documentElement.classList.remove('overlay-root')
      unsubscribe()
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!state.lastFxEvent?.at) return
    if (lastFxAtRef.current === state.lastFxEvent.at) return
    lastFxAtRef.current = state.lastFxEvent.at
    setFx(state.lastFxEvent)
  }, [state.lastFxEvent])

  useEffect(() => {
    if (!fx) return
    const duration = fx.variant === 'reset' ? 4200 : fx.variant === 'gf' ? 3400 : 2600
    const timeout = window.setTimeout(() => setFx(null), duration)
    return () => window.clearTimeout(timeout)
  }, [fx])

  const bracket = useMemo(() => buildBracket(state), [state])
  const selected = bracket.matches.find((match) => match.id === state.selectedMatchId)
  const current = selected?.ready && !selected.completed ? selected : bracket.nextMatch
  const upNext = bracket.matches.find((match) => match.ready && !match.completed && match.id !== current?.id)
  const lastDone = [...bracket.matches].reverse().find((match) => match.completed)
  const timerLive = state.timer && current && state.timer.matchId === current.id
  const isFinals = current?.side === 'finals' || current?.id === 'gfr'
  const isReset = current?.id === 'gfr'

  return (
    <div className={clsx('obs-stage', isFinals && 'obs-finals', isReset && 'obs-reset-finals')}>
      <div className="obs-topleft">
        <img
          src={logoTransparent}
          alt="連青杯"
          width="1143"
          height="513"
          decoding="async"
          fetchPriority="high"
        />
        <div>
          <strong>連青杯 Eスポーツチャンピオンシップ</strong>
          <span>DOUBLE ELIMINATION — UKENSON</span>
        </div>
      </div>

      {bracket.champion ? (
        <div className="obs-lower champion">
          <Trophy size={40} strokeWidth={1.4} />
          <div className="obs-champion-copy">
            <span>GRAND CHAMPION</span>
            <strong>{bracket.champion.name}</strong>
          </div>
        </div>
      ) : current ? (
        <div className="obs-lower">
          <div className="obs-round">
            <span className="obs-live">
              <i />
              LIVE
            </span>
            <strong>{current.name}</strong>
            {timerLive && <em className="obs-clock">{formatClock(state.timer.startedAt, now)}</em>}
          </div>
          <div className="obs-versus">
            <div className="obs-side p1">
              <strong>{current.playerA?.name}</strong>
              <span className="obs-score">{current.scoreA === '' ? 0 : current.scoreA}</span>
            </div>
            <span className="obs-vs">VS</span>
            <div className="obs-side p2">
              <span className="obs-score">{current.scoreB === '' ? 0 : current.scoreB}</span>
              <strong>{current.playerB?.name}</strong>
            </div>
          </div>
          <div className="obs-next">
            {upNext ? (
              <>
                <span>NEXT</span>
                <strong>
                  {upNext.playerA?.name || '???'} vs {upNext.playerB?.name || '???'}
                </strong>
              </>
            ) : lastDone ? (
              <>
                <span>RESULT</span>
                <strong>
                  {lastDone.playerA?.name} {lastDone.scoreA}-{lastDone.scoreB} {lastDone.playerB?.name}
                </strong>
              </>
            ) : (
              <>
                <span>FORMAT</span>
                <strong>Wエリミネーション 最大{MAX_PLAYERS}名</strong>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="obs-lower">
          <div className="obs-round">
            <strong>試合準備中…</strong>
          </div>
        </div>
      )}
      <VictoryToast fx={fx} />
    </div>
  )
}

export default App
