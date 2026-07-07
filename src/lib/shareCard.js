const CARD_WIDTH = 1080
const CARD_HEIGHT = 1600

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

function strokeGlow(ctx, color, blur, draw) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.strokeStyle = color
  draw()
  ctx.restore()
}

function drawCornerFrame(ctx, color, inset = 34) {
  const size = 96
  ctx.save()
  ctx.lineWidth = 4
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 16
  const corners = [
    [inset, inset, 1, 1],
    [CARD_WIDTH - inset, inset, -1, 1],
    [inset, CARD_HEIGHT - inset, 1, -1],
    [CARD_WIDTH - inset, CARD_HEIGHT - inset, -1, -1],
  ]
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath()
    ctx.moveTo(x, y + sy * size)
    ctx.lineTo(x, y)
    ctx.lineTo(x + sx * size, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawTechLines(ctx, color) {
  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.65
  for (let index = 0; index < 9; index += 1) {
    const y = 120 + index * 150
    ctx.beginPath()
    ctx.moveTo(62, y)
    ctx.lineTo(180, y)
    ctx.lineTo(210, y + 18)
    ctx.lineTo(340, y + 18)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(CARD_WIDTH - 62, y)
    ctx.lineTo(CARD_WIDTH - 180, y)
    ctx.lineTo(CARD_WIDTH - 210, y + 18)
    ctx.lineTo(CARD_WIDTH - 340, y + 18)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCrown(ctx, x, y, color) {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 22
  ctx.beginPath()
  ctx.moveTo(x - 58, y + 40)
  ctx.lineTo(x - 44, y - 14)
  ctx.lineTo(x - 16, y + 18)
  ctx.lineTo(x, y - 36)
  ctx.lineTo(x + 16, y + 18)
  ctx.lineTo(x + 44, y - 14)
  ctx.lineTo(x + 58, y + 40)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(x - 54, y + 48, 108, 13)
  ctx.restore()
}

function drawEmblem(ctx, x, y, color) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.globalAlpha = 0.75
  ctx.shadowColor = color
  ctx.shadowBlur = 22
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.moveTo(x, y - 56)
  ctx.lineTo(x + 72, y - 14)
  ctx.lineTo(x + 38, y + 64)
  ctx.lineTo(x, y + 26)
  ctx.lineTo(x - 38, y + 64)
  ctx.lineTo(x - 72, y - 14)
  ctx.closePath()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y - 30)
  ctx.lineTo(x + 34, y - 8)
  ctx.lineTo(x, y + 20)
  ctx.lineTo(x - 34, y - 8)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawBackground(ctx, variant) {
  const gradient = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
  gradient.addColorStop(0, '#020812')
  gradient.addColorStop(0.42, '#061224')
  gradient.addColorStop(1, '#02040a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  ctx.strokeStyle = variant === 'gf' || variant === 'reset' ? 'rgba(255,196,77,0.13)' : 'rgba(36,200,255,0.12)'
  ctx.lineWidth = 1
  for (let x = 0; x < CARD_WIDTH; x += 54) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, CARD_HEIGHT)
    ctx.stroke()
  }
  for (let y = 0; y < CARD_HEIGHT; y += 54) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(CARD_WIDTH, y)
    ctx.stroke()
  }

  const glow = ctx.createRadialGradient(CARD_WIDTH * 0.5, 260, 20, CARD_WIDTH * 0.5, 260, 520)
  glow.addColorStop(0, variant === 'gf' || variant === 'reset' ? 'rgba(255,196,77,0.22)' : 'rgba(36,200,255,0.18)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  const blueGlow = ctx.createRadialGradient(80, 1000, 40, 80, 1000, 520)
  blueGlow.addColorStop(0, 'rgba(0,145,255,0.48)')
  blueGlow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = blueGlow
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  const redGlow = ctx.createRadialGradient(CARD_WIDTH - 80, 1000, 40, CARD_WIDTH - 80, 1000, 520)
  redGlow.addColorStop(0, 'rgba(255,28,48,0.44)')
  redGlow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = redGlow
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  ctx.save()
  ctx.globalAlpha = 0.82
  ctx.strokeStyle = '#119bff'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(54, 1012)
  ctx.lineTo(54, 1260)
  ctx.lineTo(420, 1260)
  ctx.stroke()
  ctx.strokeStyle = '#ff263b'
  ctx.beginPath()
  ctx.moveTo(CARD_WIDTH - 54, 1012)
  ctx.lineTo(CARD_WIDTH - 54, 1260)
  ctx.lineTo(CARD_WIDTH - 420, 1260)
  ctx.stroke()
  ctx.restore()

  drawTechLines(ctx, 'rgba(36,200,255,0.18)')
  drawCornerFrame(ctx, 'rgba(215,235,255,0.55)')
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
  const winnerScore = match.winnerId === match.playerA?.id ? match.scoreA : match.scoreB
  const loserScore = match.winnerId === match.playerA?.id ? match.scoreB : match.scoreA
  const accent = variant === 'gf' || variant === 'reset' ? '#ffc44d' : '#24c8ff'
  const winnerColor = variant === 'reset' ? '#ffb14a' : '#ff273c'
  const loserColor = '#23a7ff'

  drawBackground(ctx, variant)

  try {
    const logo = await loadImage(logoSrc)
    ctx.globalAlpha = 0.18
    ctx.drawImage(logo, CARD_WIDTH / 2 - 180, 58, 360, 360)
    ctx.globalAlpha = 1
  } catch {
    // logo optional
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = '#f4fbff'
  ctx.shadowColor = 'rgba(220,240,255,0.88)'
  ctx.shadowBlur = 24
  ctx.font = '900 72px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText('連青杯', CARD_WIDTH / 2, 142)
  ctx.font = '900 76px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText('Eスポーツチャンピオンシップ', CARD_WIDTH / 2, 232)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(244,251,255,0.78)'
  ctx.font = '700 24px "Segoe UI", sans-serif'
  ctx.fillText('R E N S E I   C U P', CARD_WIDTH / 2, 286)

  roundRect(ctx, 322, 318, 436, 64, 10)
  ctx.strokeStyle = 'rgba(230,240,255,0.72)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.font = '800 30px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText('Wエリミネーション', CARD_WIDTH / 2, 361)

  strokeGlow(ctx, 'rgba(36,200,255,0.95)', 22, () => {
    ctx.beginPath()
    ctx.moveTo(210, 438)
    ctx.lineTo(870, 438)
    ctx.stroke()
  })
  ctx.fillStyle = accent
  ctx.shadowColor = accent
  ctx.shadowBlur = 28
  ctx.font = '900 45px "Segoe UI", sans-serif'
  ctx.fillText('M A T C H   R E S U L T', CARD_WIDTH / 2, 478)
  ctx.shadowBlur = 0

  roundRect(ctx, 244, 536, 592, 78, 12)
  ctx.fillStyle = 'rgba(7,14,25,0.88)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(235,245,255,0.62)'
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '900 30px "Segoe UI", sans-serif'
  ctx.fillText(`${String(match.roundTitle || match.name || 'MATCH').toUpperCase()} / ${match.label}`, CARD_WIDTH / 2, 586)

  roundRect(ctx, 60, 676, 960, 418, 22)
  ctx.fillStyle = 'rgba(5,10,18,0.72)'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.stroke()

  roundRect(ctx, 80, 700, 420, 336, 18)
  ctx.fillStyle = 'rgba(0,80,180,0.16)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(35,167,255,0.8)'
  ctx.shadowColor = loserColor
  ctx.shadowBlur = 18
  ctx.stroke()
  ctx.shadowBlur = 0

  roundRect(ctx, 580, 700, 420, 336, 18)
  ctx.fillStyle = 'rgba(190,12,25,0.16)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,39,60,0.86)'
  ctx.shadowColor = winnerColor
  ctx.shadowBlur = 18
  ctx.stroke()
  ctx.shadowBlur = 0

  ctx.fillStyle = loserColor
  ctx.shadowColor = loserColor
  ctx.shadowBlur = 20
  ctx.font = '900 30px "Segoe UI", sans-serif'
  ctx.fillText('LOSER', 290, 772)
  ctx.fillStyle = winnerColor
  ctx.shadowColor = winnerColor
  ctx.fillText('WINNER', 790, 772)
  ctx.shadowBlur = 0

  drawCrown(ctx, 790, 710, '#ffd86b')

  ctx.fillStyle = '#fff'
  ctx.font = '900 54px "Segoe UI", "Yu Gothic", sans-serif'
  const loserName = truncateText(ctx, loser?.name || 'PLAYER', 350)
  ctx.fillText(loserName, 290, 856)
  const winnerName = truncateText(ctx, winner?.name || 'WINNER', 350)
  ctx.fillText(winnerName, 790, 856)

  drawEmblem(ctx, 290, 962, loserColor)
  drawEmblem(ctx, 790, 962, winnerColor)

  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(255,255,255,0.95)'
  ctx.shadowBlur = 18
  ctx.font = '900 104px "Segoe UI", sans-serif'
  ctx.fillText('VS', CARD_WIDTH / 2, 900)
  ctx.shadowBlur = 0

  ctx.fillStyle = loserColor
  ctx.shadowColor = loserColor
  ctx.shadowBlur = 26
  ctx.font = '900 122px "Segoe UI", sans-serif'
  ctx.fillText(String(loserScore ?? 0), 444, 1042)
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(255,255,255,0.7)'
  ctx.fillText('-', CARD_WIDTH / 2, 1042)
  ctx.fillStyle = winnerColor
  ctx.shadowColor = winnerColor
  ctx.fillText(String(winnerScore ?? 0), 636, 1042)
  ctx.shadowBlur = 0

  ctx.fillStyle = winnerColor
  ctx.shadowColor = winnerColor
  ctx.shadowBlur = 24
  ctx.font = '800 28px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText('勝 者', CARD_WIDTH / 2, 1182)
  ctx.font = '900 82px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText(winnerName, CARD_WIDTH / 2, 1272)
  ctx.shadowBlur = 0

  roundRect(ctx, 92, 1362, 396, 106, 8)
  ctx.fillStyle = 'rgba(4,12,24,0.76)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(35,167,255,0.5)'
  ctx.stroke()
  roundRect(ctx, 592, 1362, 396, 106, 8)
  ctx.fillStyle = 'rgba(4,12,24,0.76)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,39,60,0.48)'
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = loserColor
  ctx.font = '900 34px "Segoe UI", sans-serif'
  ctx.fillText('◎', 132, 1426)
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '700 24px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText('試合番号', 210, 1410)
  ctx.fillStyle = '#fff'
  ctx.font = '900 38px "Segoe UI", sans-serif'
  ctx.fillText(match.label || 'MATCH', 210, 1450)

  ctx.fillStyle = winnerColor
  ctx.font = '900 34px "Segoe UI", sans-serif'
  ctx.fillText('♜', 632, 1426)
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '700 24px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText('ラウンド', 710, 1410)
  ctx.fillStyle = '#fff'
  ctx.font = '900 32px "Segoe UI", sans-serif'
  ctx.fillText(truncateText(ctx, match.roundTitle || match.name || 'Match', 230), 710, 1450)

  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.56)'
  ctx.font = '700 22px "Segoe UI", "Yu Gothic", sans-serif'
  ctx.fillText(tournamentName, CARD_WIDTH / 2, 1542)

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
