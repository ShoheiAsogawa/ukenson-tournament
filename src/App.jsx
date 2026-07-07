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
  Settings2,
  Shuffle,
  Swords,
  Timer,
  Trophy,
  Upload,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import logoTransparent from './assets/brand/ukenson-logo-transparent.png'
import './App.css'
import {
  buildBracket,
  clearResults,
  createInitialState,
  importEntries,
  MAX_PLAYERS,
  recordResult,
  shufflePlayers,
  updatePlayerName,
} from './lib/tournamentEngine'
import { parseEntryText } from './lib/entryImport'
import {
  hasSupabaseConfig,
  loadTournamentState,
  saveTournamentState,
  subscribeTournamentState,
} from './lib/supabaseStore'

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
  { id: 'matches', label: '試合一覧', icon: ListOrdered },
  { id: 'players', label: '選手一覧', icon: Users },
  { id: 'cards', label: '対戦カード管理', icon: Swords },
  { id: 'history', label: '結果履歴', icon: History },
  { id: 'broadcast', label: '配信・画面出力', icon: MonitorPlay },
  { id: 'settings', label: '設定', icon: Settings2 },
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

/* ---------------------------------------------------------------- */
/* Root                                                              */
/* ---------------------------------------------------------------- */

function App() {
  if (window.location.hash.includes('overlay')) {
    return <BroadcastOverlay />
  }
  const params = new URLSearchParams(window.location.search)
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

function ControlRoom({ forceSpectator = false } = {}) {
  const [state, setState] = useState(createInitialState)
  const [loadStatus, setLoadStatus] = useState('loading')
  const [saveStatus, setSaveStatus] = useState('ready')
  const [isPending, startTransition] = useTransition()
  const [view, setView] = useState('bracket')
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [fx, setFx] = useState(null)
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
    if (!fx) return
    const timeout = window.setTimeout(() => setFx(null), 2600)
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
    const match = bracket.matches.find((item) => item.id === matchId)
    const winner = match?.playerA?.id === winnerId ? match.playerA : match?.playerB
    updateState((current) => {
      const next = recordResult(current, matchId, winnerId, scoreA, scoreB, memo)
      if (next === current) return current
      return autoAdvance ? next : { ...next, selectedMatchId: current.selectedMatchId }
    })
    if (winner) {
      setFx({ matchId, name: winner.name, side: match.side, at: Date.now() })
    }
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

  const hasResults = Object.keys(state.results || {}).length > 0
  const spectator = forceSpectator || state.mode === 'spectator'

  return (
    <div className={clsx('app-frame', spectator && 'spectator')}>
      <div className="bg-fx" aria-hidden="true">
        <div className="bg-grid" />
        <div className="bg-glow cyan" />
        <div className="bg-glow ember" />
        <div className="bg-beam" />
      </div>

      <TopBar
        mode={forceSpectator ? 'spectator' : state.mode}
        saveStatus={saveStatus}
        loadStatus={loadStatus}
        isPending={isPending}
        hideModeToggle={forceSpectator}
        onModeChange={(mode) => updateState((current) => ({ ...current, mode }))}
      />

      {!spectator && (
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

      <main className="stage">
        {view === 'bracket' || spectator ? (
          <>
            <BracketCanvas
              bracket={bracket}
              selectedMatchId={selectedMatch?.id}
              timer={state.timer}
              fx={fx}
              onSelect={(id) => updateState((current) => ({ ...current, selectedMatchId: id }))}
              onShuffle={spectator ? null : () => updateState((current) => shufflePlayers(current))}
              shuffleLocked={hasResults}
            />
            <TimelineStrip
              bracket={bracket}
              selectedMatchId={selectedMatch?.id}
              timer={state.timer}
              onSelect={(id) => updateState((current) => ({ ...current, selectedMatchId: id }))}
            />
          </>
        ) : (
          <SubView
            view={view}
            state={state}
            bracket={bracket}
            selectedMatchId={selectedMatch?.id}
            onSelect={(id) => {
              updateState((current) => ({ ...current, selectedMatchId: id }))
              setView('bracket')
            }}
            onNameChange={(playerId, name) => updateState((current) => updatePlayerName(current, playerId, name))}
            onImportEntries={(entries, source) => updateState((current) => importEntries(current, entries, source))}
            onShuffle={() => updateState((current) => shufflePlayers(current))}
            shuffleLocked={hasResults}
            onReset={() => updateState(clearResults)}
          />
        )}
      </main>

      {!spectator && (
        <ResultPanel
          match={selectedMatch}
          timer={state.timer}
          autoAdvance={autoAdvance}
          setAutoAdvance={setAutoAdvance}
          onRecord={handleRecord}
        />
      )}

      <VictoryToast fx={fx} />
      <ChampionOverlay champion={bracket.champion} />
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Top bar                                                           */
/* ---------------------------------------------------------------- */

function TopBar({ mode, saveStatus, loadStatus, isPending, onModeChange, hideModeToggle = false }) {
  const syncLabel = isPending
    ? '同期中'
    : loadStatus === 'loading'
      ? '読込中'
      : saveStatus === 'saving'
        ? '保存中'
        : saveStatus === 'error'
          ? '保存エラー'
          : '保存済み'

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

function BracketCanvas({ bracket, selectedMatchId, timer, fx, onSelect, onShuffle, shuffleLocked }) {
  const { matches, champion, playerCount } = bracket
  const matchMap = useMemo(() => Object.fromEntries(matches.map((match) => [match.id, match])), [matches])
  const layout = useMemo(() => computeLayout(matches), [matches])
  const viewportRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState('fit')

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

  return (
    <div className="bracket-wrap">
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
/* Sub views                                                         */
/* ---------------------------------------------------------------- */

function SubView({
  view,
  state,
  bracket,
  selectedMatchId,
  onSelect,
  onNameChange,
  onImportEntries,
  onShuffle,
  shuffleLocked,
  onReset,
}) {
  if (view === 'matches') return <MatchesView bracket={bracket} selectedMatchId={selectedMatchId} onSelect={onSelect} />
  if (view === 'players') return <PlayersView state={state} onNameChange={onNameChange} />
  if (view === 'cards')
    return (
      <CardsView state={state} onImportEntries={onImportEntries} onShuffle={onShuffle} shuffleLocked={shuffleLocked} />
    )
  if (view === 'history') return <HistoryView state={state} bracket={bracket} onSelect={onSelect} />
  if (view === 'broadcast') return <BroadcastView />
  if (view === 'settings') return <SettingsView onReset={onReset} />
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

function PlayersView({ state, onNameChange }) {
  return (
    <ViewShell
      icon={Users}
      title="選手一覧"
      sub={`最大${MAX_PLAYERS}名まで登録できます。名前は結果を保持したまま変更できます`}
    >
      <div className="player-grid">
        {state.players.map((player) => (
          <label key={player.id} className={clsx('player-cell', player.active === false && 'inactive')}>
            <span>SEED {player.seed}</span>
            <input value={player.name} onChange={(event) => onNameChange(player.id, event.target.value)} />
          </label>
        ))}
      </div>
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

function HistoryView({ state, bracket, onSelect }) {
  const entries = bracket.matches
    .filter((match) => match.completed)
    .map((match) => ({ match, saved: state.results[match.id] }))
    .sort((a, b) => new Date(b.saved?.recordedAt || 0) - new Date(a.saved?.recordedAt || 0))

  return (
    <ViewShell icon={History} title="結果履歴" sub="記録した結果の一覧（クリックで再入力）">
      {entries.length === 0 && <p className="empty-note">まだ記録された結果はありません。</p>}
      <div className="history-list">
        {entries.map(({ match, saved }) => {
          const winner = match.winnerId === match.playerA?.id ? match.playerA : match.playerB
          return (
            <button key={match.id} type="button" className="history-line" onClick={() => onSelect(match.id)}>
              <span className="line-code">{match.label}</span>
              <strong>
                {match.playerA?.name} {match.scoreA} - {match.scoreB} {match.playerB?.name}
              </strong>
              <span className="history-winner">
                <Crown size={12} /> {winner?.name}
              </span>
              <span className="history-time">
                {saved?.recordedAt ? new Date(saved.recordedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              {saved?.memo && <span className="history-memo">{saved.memo}</span>}
            </button>
          )
        })}
      </div>
    </ViewShell>
  )
}

function BroadcastView() {
  const overlayUrl = `${window.location.origin}${window.location.pathname}#/overlay`
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
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
            <button type="button" className="action-button" onClick={copy}>
              <Clipboard size={16} />
              <span>{copied ? 'コピーしました' : 'URLをコピー'}</span>
            </button>
          </div>
          <code className="overlay-url">{overlayUrl}</code>
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
  return (
    <AnimatePresence>
      {fx && (
        <motion.div
          key={fx.at}
          className={clsx('victory-toast', fx.side)}
          initial={{ opacity: 0, x: 80, skewX: -8 }}
          animate={{ opacity: 1, x: 0, skewX: -8 }}
          exit={{ opacity: 0, x: -60, skewX: -8 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        >
          <span className="toast-label">WINNER</span>
          <strong>{fx.name}</strong>
          <span className="toast-sweep" aria-hidden="true" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ChampionOverlay({ champion }) {
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
          >
            <Trophy size={72} strokeWidth={1.4} />
            <span>GRAND CHAMPION</span>
            <h2>{champion.name}</h2>
            <p>連青杯 Eスポーツチャンピオンシップ 優勝</p>
            <em>クリックで閉じる</em>
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

  const bracket = useMemo(() => buildBracket(state), [state])
  const selected = bracket.matches.find((match) => match.id === state.selectedMatchId)
  const current = selected?.ready && !selected.completed ? selected : bracket.nextMatch
  const upNext = bracket.matches.find((match) => match.ready && !match.completed && match.id !== current?.id)
  const lastDone = [...bracket.matches].reverse().find((match) => match.completed)
  const timerLive = state.timer && current && state.timer.matchId === current.id

  return (
    <div className="obs-stage">
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
    </div>
  )
}

export default App
