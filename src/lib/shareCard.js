const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawBackground(ctx, variant) {
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT)
  if (variant === 'gf' || variant === 'reset') {
    gradient.addColorStop(0, '#1a1204')
    gradient.addColorStop(0.45, '#2d1f08')
    gradient.addColorStop(1, '#090b14')
  } else {
    gradient.addColorStop(0, '#07111f')
    gradient.addColorStop(0.5, '#0d1830')
    gradient.addColorStop(1, '#05070f')
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  ctx.strokeStyle = variant === 'gf' || variant === 'reset' ? 'rgba(255,196,77,0.18)' : 'rgba(36,200,255,0.12)'
  ctx.lineWidth = 1
  for (let x = 0; x < CARD_WIDTH; x += 48) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, CARD_HEIGHT)
    ctx.stroke()
  }
  for (let y = 0; y < CARD_HEIGHT; y += 48) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(CARD_WIDTH, y)
    ctx.stroke()
  }

  const glow = ctx.createRadialGradient(CARD_WIDTH * 0.5, CARD_HEIGHT * 0.35, 20, CARD_WIDTH * 0.5, CARD_HEIGHT * 0.35, 420)
  glow.addColorStop(0, variant === 'gf' || variant === 'reset' ? 'rgba(255,196,77,0.22)' : 'rgba(36,200,255,0.18)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let trimmed = text
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1)
  }
  return `${trimmed}…`
}

function getVariant(match) {
  if (match.id === 'gfr') return 'reset'
  if (match.side === 'finals') return 'gf'
  return 'normal'
}

export async function renderShareCard({ match, logoSrc, tournamentName = '連青杯 Eスポーツチャンピオンシップ' }) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  const variant = getVariant(match)
  const winner = match.winnerId === match.playerA?.id ? match.playerA : match.playerB
  const loser = match.winnerId === match.playerA?.id ? match.playerB : match.playerA
  const accent = variant === 'gf' || variant === 'reset' ? '#ffc44d' : '#24c8ff'

  drawBackground(ctx, variant)

  try {
    const logo = await loadImage(logoSrc)
    ctx.drawImage(logo, 48, 42, 72, 72)
  } catch {
    // logo optional
  }

  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '600 22px "Segoe UI", sans-serif'
  ctx.fillText(tournamentName, 140, 68)
  ctx.fillStyle = accent
  ctx.font = '700 16px "Segoe UI", sans-serif'
  ctx.fillText('DOUBLE ELIMINATION — UKENSON', 140, 98)

  ctx.fillStyle = accent
  ctx.font = '900 18px "Segoe UI", sans-serif'
  ctx.fillText((match.roundTitle || match.name || 'MATCH RESULT').toUpperCase(), 48, 168)

  roundRect(ctx, 48, 196, CARD_WIDTH - 96, 300, 24)
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fill()
  ctx.strokeStyle = variant === 'gf' || variant === 'reset' ? 'rgba(255,196,77,0.35)' : 'rgba(36,200,255,0.28)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = '900 54px "Segoe UI", sans-serif'
  const winnerName = truncateText(ctx, winner?.name || 'WINNER', 420)
  ctx.fillText(winnerName, CARD_WIDTH * 0.28, 300)

  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = '700 28px "Segoe UI", sans-serif'
  const loserName = truncateText(ctx, loser?.name || 'PLAYER', 420)
  ctx.fillText(loserName, CARD_WIDTH * 0.72, 300)

  ctx.fillStyle = accent
  ctx.font = '900 88px "Segoe UI", sans-serif'
  ctx.fillText(`${match.scoreA} - ${match.scoreB}`, CARD_WIDTH * 0.5, 360)

  roundRect(ctx, CARD_WIDTH * 0.5 - 110, 228, 220, 44, 22)
  ctx.fillStyle = variant === 'reset' ? '#ff5b3a' : accent
  ctx.fill()
  ctx.fillStyle = variant === 'reset' ? '#fff' : '#041018'
  ctx.font = '900 20px "Segoe UI", sans-serif'
  ctx.fillText(variant === 'reset' ? 'BRACKET RESET' : 'WIN', CARD_WIDTH * 0.5, 258)

  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = '600 18px "Segoe UI", sans-serif'
  ctx.fillText(`${match.label} · ${match.playerA?.name} vs ${match.playerB?.name}`, 48, 548)
  ctx.fillStyle = accent
  ctx.font = '700 18px "Segoe UI", sans-serif'
  ctx.fillText('#連青杯 #UKENSON', 48, 582)

  return canvas.toDataURL('image/png')
}

export async function downloadShareCard(dataUrl, filename) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.click()
}

export async function shareOrDownloadShareCard(dataUrl, filename, title) {
  try {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    const file = new File([blob], filename, { type: 'image/png' })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title })
      return 'shared'
    }
  } catch {
    // fall back to download
  }

  await downloadShareCard(dataUrl, filename)
  return 'downloaded'
}

export function shareCardFilename(match) {
  const safe = (value) =>
    String(value || 'match')
      .replace(/[^\w\u3040-\u30ff\u3400-\u9fff-]+/g, '-')
      .slice(0, 40)
  return `ukenson-${safe(match.label)}-${safe(match.playerA?.name)}-vs-${safe(match.playerB?.name)}.png`
}
