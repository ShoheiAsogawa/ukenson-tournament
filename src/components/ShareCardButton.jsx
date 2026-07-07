import { useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import clsx from 'clsx'
import logoTransparent from '../assets/brand/ukenson-logo-transparent.png'
import { renderShareCard, shareCardFilename, shareOrDownloadShareCard } from '../lib/shareCard'

export default function ShareCardButton({ match, className, label = 'SNSカード', luxury = false }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  if (!match?.completed || match.bye) return null

  const handleShare = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return

    setBusy(true)
    setStatus('')
    try {
      const dataUrl = await renderShareCard({ match, logoSrc: logoTransparent })
      const result = await shareOrDownloadShareCard(dataUrl, shareCardFilename(match), `${match.label} 結果`)
      setStatus(result === 'shared' ? '共有しました' : '保存しました')
      window.setTimeout(() => setStatus(''), 1800)
    } catch {
      setStatus('生成に失敗しました')
      window.setTimeout(() => setStatus(''), 1800)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={clsx('share-card-wrap', className)}>
      <button
        type="button"
        className={clsx('action-button share-card-button', luxury && 'luxury')}
        disabled={busy}
        onClick={handleShare}
      >
        {busy ? <Download size={16} /> : <Share2 size={16} />}
        <span>{busy ? '生成中…' : label}</span>
      </button>
      {status && <span className="share-card-status">{status}</span>}
    </div>
  )
}
