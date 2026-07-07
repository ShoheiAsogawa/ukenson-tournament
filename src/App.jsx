import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
import logoTransparent from './assets/brand/ukenson-logo-transparent.png'
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
  buildPlayerProfile,
  findPlayersByQuery,
  getTournamentHighlights,
  isGrandFinalsPhase,
  isResetFinalActive,
} from './lib/playerInsights'
import { parseEntryText } from './lib/entryImport'
import {
  hasSupabaseConfig,
  loadTournamentState,
  saveTournamentState,
  subscribeTournamentState,
} from './lib/supabaseStore'
import { renderShareCard } from './lib/shareCard'

/* ---------------------------------------------------------------- */
/* Bracket geometry (computed from the generated bracket)            */
/* ---------------------------------------------------------------- */

const CARD_W = 216
const CARD_H = 82
const PAD = 24
const GAP_Y = 26
const COL_W = CARD_W + 60
const SECTION_GAP = 104

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
  { id: 'highlights', label: 'ハイライト', icon: Sparkles },
  { id: 'matches', label: '試合一覧', icon: ListOrdered },
  { id: 'players', label: '選手一覧', icon: Users },
  { id: 'cards', label: '対戦カード管理', icon: Swords },
  { id: 'history', label: '結果履歴', icon: History },
  { id: 'broadcast', label: '配信・画面出力', icon: MonitorPlay },
  { id: 'settings', label: '設定', icon: Settings2 },
]

const PUBLIC_NAV_ITEMS = [
  { id: 'bracket', label: 'トーナメント表', icon: Trophy },
  { id: 'lookup', label: '検索', icon: Search },
  { id: 'highlights', label: '注目', icon: Sparkles },
  { id: 'history', label: '結果', icon: History },
]

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

function AdminGate() {
  const [authed, setAuthed] = useState(() => {
    try {
      return window.sessionStorage.getItem(ADMIN_AUTH_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  if (authed) return <ControlRoom />

  const handleSubmit = (event) => {
    event.preventDefault()
    if (pin === ADMIN_PIN) {
      try {
        window.sessionStorage.setItem(ADMIN_AUTH_KEY, 'true')
      } catch {
        // ignore storage errors
      }
      setAuthed(true)
      setError('')
    } else {
      setError('パスコードが違います')
      setPin('')
    }
  }

  return (
    <div className="admin-gate">
      <form className="admin-gate-card" onSubmit={handleSubmit}>
        <h1>運営ログイン</h1>
        <p>管理画面にアクセスするにはパスコードを入力してください。</p>
        <input
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="パスコード"
          autoFocus
        />
        {error && <p className="admin-gate-error">{error}</p>}
        <button type="submit">入室する</button>
      </form>
    </div>
  )
}

function ControlRoom({ forceSpectator = false, forcePlayerPage = false } = {}) {
  const [state, setState] = useState(createInitialState)
  const [loadStatus, setLoadStatus] = useState('loading')
  const [saveStatus, setSaveStatus] = useState('ready')
  const [isPending, startTransition] = useTransition()
  const [view, setView] = useState(forcePlayerPage ? 'lookup' : 'bracket')
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [fx, setFx] = useState(null)
  const isMobile = useIsMobile()
  const [resultSheetOpen, setResultSheetOpen] = useState(false)
  const [resultPreviewMatchId, setResultPreviewMatchId] = useState(null)
  const lastFxAtRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

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
    if (loadStatus === 'loading') return
    const timeout = window.setTimeout(() => {
      setSaveStatus('saving')
      saveTournamentState(state)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'))
    }, 240)

    return () => window.clearTimeout(timeout)
  }, [state, loadStatus])

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
  const selectedMatch =
    bracket.matches.find((match) => match.id === state.selectedMatchId) ||
    bracket.nextMatch ||
    bracket.matches.find((match) => !match.bye) ||
    bracket.matches[0]

  const updateState = (updater) => setState((current) => updater(current))

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
            bracket={bracket}
            selectedMatchId={selectedMatch?.id}
            timer={state.timer}
            fx={fx}
            onSelect={handleMatchBoxSelect}
          />
        ) : view === 'bracket' ? (
          <>
            <BracketCanvas
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
        <img src={logoTransparent} alt="連青杯 Eスポーツチャンピオンシップ UKENSON" />
        <div className="brand-copy">
          <div className="brand-title-row">
            <h1>連青杯 Eスポーツチャンピオンシップ</h1>
            <span className="format-chip">Wエリミネーション</span>
          </div>
          <p>7分・3ストック・アイテムなし・チャージ切りふだなし</p>
        </div>
      </div>

      <div className="topbar-right">
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
      </div>
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

function BracketCanvas({ bracket, selectedMatchId, timer, fx, onSelect, onShuffle, shuffleLocked, playerPage = false }) {
  const { matches, champion, playerCount } = bracket
  const matchMap = useMemo(() => Object.fromEntries(matches.map((match) => [match.id, match])), [matches])
  const layout = useMemo(() => computeLayout(matches), [matches])
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

function BracketMatchCard({ match, x, y, active, live, justWon, onSelect }) {
  const tone = match.side === 'finals' ? 'gold' : match.side === 'winners' ? 'cyan' : 'ember'
  const status = match.bye ? 'BYE' : match.completed ? '完了' : live ? 'LIVE' : match.ready ? 'READY' : '---'

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
      <SlotRow match={match} who="a" />
      <SlotRow match={match} who="b" />
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

    renderShareCard({ match, logoSrc: logoTransparent })
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

function SlotRow({ match, who }) {
  const player = who === 'a' ? match.playerA : match.playerB
  const score = who === 'a' ? match.scoreA : match.scoreB
  const hint = who === 'a' ? match.hintA : match.hintB
  const isWinner = Boolean(player && match.winnerId === player.id)
  const isLoser = Boolean(player && match.winnerId && match.winnerId !== player.id)

  return (
    <div className={clsx('slot-row', isWinner && 'winner', isLoser && 'loser')}>
      <span className="slot-name">
        {player ? player.name : <em>{hint}</em>}
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

function PlayerBracketView({ bracket, selectedMatchId, timer, fx, onSelect }) {
  return (
    <section className="player-bracket-page" aria-label="トーナメント表">
      <img src={logoTransparent} alt="連青杯" className="player-bracket-logo" />
      <BracketCanvas
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
  const suggestedPlayers = query.trim() ? matches : activePlayers.slice(0, 12)

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
        <img src={logoTransparent} alt="連青杯" className="player-page-logo" />
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

      {suggestedPlayers.length > 0 && (
        <div className="player-page-chips">
          {suggestedPlayers.map((player) => (
            <button
              key={player.id}
              type="button"
              className={clsx('player-page-chip', selectedPlayer?.id === player.id && 'active')}
              onClick={() => {
                setSelectedId(player.id)
                setQuery(player.name)
              }}
            >
              {player.name}
            </button>
          ))}
        </div>
      )}

      {!query.trim() && activePlayers.length === 0 && (
        <p className="player-page-empty">まだ選手が登録されていません。運営側でエントリーを登録すると、ここから検索できます。</p>
      )}
      {!query.trim() && activePlayers.length > 0 && !profile && (
        <p className="player-page-empty">名前を入力するか、上の候補から自分の名前を選んでください。</p>
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

function HighlightsView({ state, bracket, playerPage = false }) {
  const highlights = useMemo(() => getTournamentHighlights(state, bracket), [state, bracket])

  const body = (
    <>
      <div className="highlights-summary">
        <div className="highlight-stat">
          <span>生存選手</span>
          <strong>{highlights.aliveCount}名</strong>
        </div>
        <div className="highlight-stat">
          <span>平均試合間隔</span>
          <strong>約{highlights.avgMatchMinutes}分</strong>
        </div>
      </div>

      <div className="highlights-grid">
        <div className="highlight-card">
          <span>最多連勝</span>
          <strong>{highlights.topStreak?.player.name || '—'}</strong>
          <em>{highlights.topStreak ? `${highlights.topStreak.stats.winStreak}連勝` : 'データなし'}</em>
        </div>
        <div className="highlight-card">
          <span>最多アップセット</span>
          <strong>{highlights.topUpsets?.player.name || '—'}</strong>
          <em>{highlights.topUpsets ? `${highlights.topUpsets.stats.upsets}回` : 'データなし'}</em>
        </div>
        <div className="highlight-card">
          <span>最多ゲーム数</span>
          <strong>{highlights.topGames?.player.name || '—'}</strong>
          <em>{highlights.topGames ? `${highlights.topGames.stats.totalGames}ゲーム` : 'データなし'}</em>
        </div>
      </div>

      <div className="candidate-board">
        <h3>優勝候補ランキング</h3>
        {highlights.candidates.length === 0 ? (
          <p className="empty-note">まだ候補を算出できません。</p>
        ) : (
          <div className="candidate-list">
            {highlights.candidates.slice(0, 12).map((item) => (
              <div key={item.player.id} className="candidate-line">
                <span className="candidate-rank">#{item.rank}</span>
                <strong>{item.player.name}</strong>
                <em>{item.status.label}</em>
                <span>
                  {item.stats.wins}勝 {item.stats.upsets}UP
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )

  if (playerPage) {
    return (
      <section className="player-page-shell player-subpage">
        <header className="player-page-header compact">
          <div>
            <p className="player-page-eyebrow">UKENSON TOURNAMENT</p>
            <h1>ハイライト</h1>
          </div>
        </header>
        {body}
      </section>
    )
  }

  return (
    <ViewShell icon={Sparkles} title="ハイライト" sub="連勝・アップセット・優勝候補など、大会の見どころを一覧表示">
      {body}
    </ViewShell>
  )
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
    return <PlayerBracketView bracket={bracket} selectedMatchId={selectedMatchId} timer={timer} fx={fx} onSelect={onSelect} />
  if (view === 'lookup') return <PlayerLookupView state={state} bracket={bracket} playerPage={playerPage} />
  if (view === 'highlights') return <HighlightsView state={state} bracket={bracket} playerPage={playerPage} />
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
        <img src={logoTransparent} alt="連青杯" />
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
