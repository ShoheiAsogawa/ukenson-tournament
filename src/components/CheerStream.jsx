import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import clsx from 'clsx'
import {
  MAX_CHEER_COMMENT_LENGTH,
  sendCheerComment,
  subscribeCheerComments,
} from '../lib/supabaseStore'

const LANE_COUNT = 6
const BROADCAST_LANE_COUNT = 8
const MAX_VISIBLE_COMMENTS = 40
const TONES = ['cyan', 'ember', 'gold', 'violet']
const SEND_COOLDOWN_MS = 2500
const CHEER_FLOW_SPEED = 1.5

function getCheerVariantConfig(variant) {
  if (variant === 'broadcast') {
    return { laneCount: BROADCAST_LANE_COUNT, laneStep: 7, topOffset: 4, baseDuration: 9 }
  }
  if (variant === 'page') {
    return { laneCount: LANE_COUNT, laneStep: 9, topOffset: 6, baseDuration: 7.5 }
  }
  return { laneCount: LANE_COUNT, laneStep: 9, topOffset: 6, baseDuration: 9 }
}

export function CheerOverlay({ variant = 'screen' }) {
  const [items, setItems] = useState([])
  const laneRef = useRef(0)
  const keyRef = useRef(0)
  const cleanupTimersRef = useRef(new Set())

  const removeItem = useCallback((key) => {
    setItems((current) => current.filter((item) => item.key !== key))
  }, [])

  useEffect(() => {
    const timers = cleanupTimersRef.current
    const { laneCount, laneStep, topOffset, baseDuration } = getCheerVariantConfig(variant)
    const unsubscribe = subscribeCheerComments((comment) => {
      const lane = laneRef.current
      laneRef.current = (laneRef.current + 1) % laneCount
      keyRef.current += 1
      const item = {
        key: `${comment.id}-${keyRef.current}`,
        body: comment.body,
        lane,
        laneStep,
        topOffset,
        jitter: Math.floor(Math.random() * 14),
        tone: TONES[Math.floor(Math.random() * TONES.length)],
        duration:
          (baseDuration + Math.min(4, comment.body.length * 0.18) + Math.random() * 1.5) /
          CHEER_FLOW_SPEED,
      }
      setItems((current) => {
        if (current.length >= MAX_VISIBLE_COMMENTS) return current
        return [...current, item]
      })
      // animationend does not fire while the page is hidden, so make sure
      // items always leave the list even on locked/backgrounded screens.
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        removeItem(item.key)
      }, (item.duration + 2) * 1000)
      timers.add(timer)
    })
    return () => {
      unsubscribe()
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
    }
  }, [variant, removeItem])

  if (items.length === 0) return null

  return (
    <div className={clsx('cheer-overlay', variant)} aria-hidden="true">
      {items.map((item) => (
        <span
          key={item.key}
          className={clsx('cheer-item', item.tone)}
          style={{
            top: `calc(${item.topOffset + item.lane * item.laneStep}% + ${item.jitter}px)`,
            animationDuration: `${item.duration}s`,
          }}
          onAnimationEnd={() => removeItem(item.key)}
        >
          {item.body}
        </span>
      ))}
    </div>
  )
}

export function CheerComposer({ placement = 'float' }) {
  const topRight = placement === 'top-right'
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [cooling, setCooling] = useState(false)
  const [notice, setNotice] = useState(null)
  const inputRef = useRef(null)
  const timersRef = useRef([])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const queueTimer = (fn, delay) => {
    timersRef.current.push(window.setTimeout(fn, delay))
  }

  const flashNotice = (tone, message) => {
    setNotice({ tone, message })
    queueTimer(() => setNotice(null), 2600)
  }

  const submit = async (body) => {
    if (sending || cooling) return
    const trimmed = String(body || '').trim()
    if (!trimmed) return
    setSending(true)
    try {
      await sendCheerComment(trimmed)
      setText('')
      setCooling(true)
      queueTimer(() => setCooling(false), SEND_COOLDOWN_MS)
      flashNotice('ok', '送信しました！')
    } catch (error) {
      const code = String(error?.message || '')
      if (code === 'rate_limited') flashNotice('error', '送信が早すぎます。少し待ってね')
      else if (code === 'blocked') flashNotice('error', 'この内容は送信できません')
      else if (code === 'comments_disabled') flashNotice('error', 'コメントは現在停止中です')
      else if (code === 'function_not_found') flashNotice('error', 'サーバー設定が未完了です（運営に連絡してください）')
      else if (code === 'network_error') flashNotice('error', '通信エラーです。回線を確認してください')
      else flashNotice('error', '送信できませんでした')
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={clsx('cheer-fab', topRight && 'top-right')}
        onClick={() => setOpen(true)}
        aria-label="コメントを送る"
      >
        <MessageCircle size={topRight ? 20 : 22} />
      </button>
    )
  }

  return (
    <div className={clsx('cheer-composer', topRight && 'top-right')}>
      <form
        className="cheer-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit(text)
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          maxLength={MAX_CHEER_COMMENT_LENGTH}
          placeholder={`最大${MAX_CHEER_COMMENT_LENGTH}文字`}
          enterKeyHint="send"
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={sending || cooling || !text.trim()} aria-label="送信">
          <Send size={16} />
        </button>
        <button type="button" className="cheer-close" onClick={() => setOpen(false)} aria-label="閉じる">
          <X size={16} />
        </button>
      </form>
      {notice && <p className={clsx('cheer-notice', notice.tone)}>{notice.message}</p>}
      {cooling && !notice && <p className="cheer-notice cool">連続送信はすこし間をあけてね</p>}
    </div>
  )
}
